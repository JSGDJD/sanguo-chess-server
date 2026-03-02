const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const httpServer = createServer(app);

const PORT = process.env.PORT || 3000;

const dataDir = path.join(__dirname, 'data');
const usersFile = path.join(dataDir, 'users.json');
const roomsFile = path.join(dataDir, 'rooms.json');
const recordsFile = path.join(dataDir, 'records.json');

let users = new Map();
let rooms = new Map();
let gameRecords = [];
let userIdCounter = 1;

function initDatabase() {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    
    if (fs.existsSync(usersFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
            const usersArray = data.users || [];
            users.clear();
            let maxId = 0;
            usersArray.forEach(user => {
                const id = Number(user.id);
                if (id > maxId) maxId = id;
                users.set(id, user);
            });
            userIdCounter = maxId + 1;
        } catch (e) {}
    }
    
    console.log('[Database] 数据库初始化完成');
}

function saveUsers() {
    const usersArray = Array.from(users.values());
    fs.writeFileSync(usersFile, JSON.stringify({ users: usersArray }, null, 2), 'utf8');
}

const wss = new WebSocketServer({ 
    server: httpServer,
    path: '/ws'
});

app.use(cors());
app.use(express.json());

initDatabase();

app.get('/', (req, res) => {
    res.json({
        name: '三国象棋服务器',
        version: '1.0.0',
        status: 'running',
        users: users.size,
        rooms: rooms.size
    });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

app.post('/api/auth/register', (req, res) => {
    const { username, password, nickname } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    
    if (Array.from(users.values()).some(u => u.username === username)) {
        return res.status(400).json({ error: '用户名已存在' });
    }
    
    const id = userIdCounter++;
    users.set(id, {
        id, username, password, nickname: nickname || username,
        avatar: 'default', wins: 0, losses: 0, draws: 0, rating: 1000,
        created_at: new Date().toISOString()
    });
    saveUsers();
    
    res.json({
        success: true,
        userId: id,
        message: '注册成功'
    });
});

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    
    for (const user of users.values()) {
        if (user.username === username && user.password === password) {
            return res.json({
                success: true,
                user: {
                    id: user.id,
                    username: user.username,
                    nickname: user.nickname,
                    avatar: user.avatar,
                    wins: user.wins,
                    losses: user.losses,
                    draws: user.draws,
                    rating: user.rating
                }
            });
        }
    }
    
    res.status(401).json({ error: '用户名或密码错误' });
});

app.get('/api/user/profile', (req, res) => {
    const userId = req.query.userId;
    const user = users.get(Number(userId));
    
    if (user) {
        res.json({ user });
    } else {
        res.status(404).json({ error: '用户不存在' });
    }
});

app.put('/api/user/profile', (req, res) => {
    const { userId, nickname } = req.body;
    const user = users.get(Number(userId));
    
    if (user) {
        if (nickname) user.nickname = nickname;
        users.set(Number(userId), user);
        saveUsers();
        res.json({ success: true, user });
    } else {
        res.status(404).json({ error: '用户不存在' });
    }
});

app.put('/api/user/password', (req, res) => {
    const { userId, oldPassword, newPassword } = req.body;
    const user = users.get(Number(userId));
    
    if (!user || user.password !== oldPassword) {
        return res.status(401).json({ error: '旧密码错误' });
    }
    
    user.password = newPassword;
    users.set(Number(userId), user);
    saveUsers();
    res.json({ success: true });
});

const clientRooms = new Map();

wss.on('connection', (ws) => {
    console.log('[WebSocket] 客户端连接');
    
    ws.userId = null;
    ws.userName = null;
    ws.currentRoom = null;
    ws.isAlive = true;
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            handleMessage(ws, message);
        } catch (error) {
            console.error('[WebSocket] 消息解析错误:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('[WebSocket] 客户端断开');
        if (ws.currentRoom) {
            handleLeaveRoom(ws);
        }
    });
    
    ws.on('pong', () => {
        ws.isAlive = true;
    });
});

function sendMessage(ws, event, data = {}) {
    if (ws.readyState === 1) {
        ws.send(JSON.stringify({ event, data }));
    }
}

function handleMessage(ws, message) {
    const { event, data } = message;
    
    switch (event) {
        case 'auth':
            ws.userId = data?.userId || uuidv4().substring(0, 8);
            ws.userName = data?.userName || `玩家_${ws.userId.substring(0, 4)}`;
            sendMessage(ws, 'auth:success', { userId: ws.userId, userName: ws.userName });
            break;
        case 'room:create':
            handleCreateRoom(ws, data);
            break;
        case 'room:list':
            handleRoomList(ws);
            break;
        case 'room:join':
            handleJoinRoom(ws, data);
            break;
        case 'room:leave':
            handleLeaveRoom(ws);
            break;
        case 'player:faction':
            handleSetFaction(ws, data);
            break;
        case 'player:ready':
            handleSetReady(ws, data);
            break;
        case 'game:start':
            handleStartGame(ws);
            break;
    }
}

function handleCreateRoom(ws, data) {
    const roomId = uuidv4().substring(0, 8);
    const room = {
        id: roomId,
        name: data?.name || `${ws.userName}的房间`,
        hostId: ws.userId,
        hostName: ws.userName,
        password: data?.password || '',
        maxPlayers: data?.maxPlayers || 3,
        gameMode: data?.gameMode || 'standard',
        status: 'waiting',
        players: [{
            id: ws.userId,
            name: ws.userName,
            faction: -1,
            isReady: false,
            isHost: true
        }]
    };
    
    rooms.set(roomId, room);
    ws.currentRoom = roomId;
    
    if (!clientRooms.has(roomId)) {
        clientRooms.set(roomId, new Set());
    }
    clientRooms.get(roomId).add(ws);
    
    sendMessage(ws, 'room:created', room);
    broadcastRoomList();
}

function handleRoomList(ws) {
    const roomList = [];
    rooms.forEach((room) => {
        if (room.status === 'waiting') {
            roomList.push({
                id: room.id,
                name: room.name,
                hostName: room.hostName,
                currentPlayers: room.players.length,
                maxPlayers: room.maxPlayers,
                gameMode: room.gameMode,
                hasPassword: !!room.password
            });
        }
    });
    sendMessage(ws, 'room:list', roomList);
}

function handleJoinRoom(ws, data) {
    const roomId = data?.roomId;
    const room = rooms.get(roomId);
    
    if (!room) {
        return sendMessage(ws, 'room:join:failed', { error: '房间不存在' });
    }
    
    if (room.players.length >= room.maxPlayers) {
        return sendMessage(ws, 'room:join:failed', { error: '房间已满' });
    }
    
    if (room.password && room.password !== data?.password) {
        return sendMessage(ws, 'room:join:failed', { error: '密码错误' });
    }
    
    room.players.push({
        id: ws.userId,
        name: ws.userName,
        faction: -1,
        isReady: false,
        isHost: false
    });
    
    ws.currentRoom = roomId;
    
    if (!clientRooms.has(roomId)) {
        clientRooms.set(roomId, new Set());
    }
    clientRooms.get(roomId).add(ws);
    
    sendMessage(ws, 'room:joined', room);
    broadcast(roomId, 'room:update', room);
    broadcastRoomList();
}

function handleLeaveRoom(ws) {
    const roomId = ws.currentRoom;
    const room = rooms.get(roomId);
    
    if (room) {
        const playerIndex = room.players.findIndex(p => p.id === ws.userId);
        if (playerIndex !== -1) {
            room.players.splice(playerIndex, 1);
            
            if (room.players.length === 0) {
                rooms.delete(roomId);
                clientRooms.delete(roomId);
            } else {
                if (room.hostId === ws.userId) {
                    room.players[0].isHost = true;
                    room.hostId = room.players[0].id;
                    room.hostName = room.players[0].name;
                }
                broadcast(roomId, 'room:update', room);
            }
        }
    }
    
    if (clientRooms.has(roomId)) {
        clientRooms.get(roomId).delete(ws);
    }
    
    ws.currentRoom = null;
    sendMessage(ws, 'room:left');
    broadcastRoomList();
}

function handleSetFaction(ws, data) {
    const room = rooms.get(ws.currentRoom);
    if (!room) return;
    
    const player = room.players.find(p => p.id === ws.userId);
    if (player) {
        player.faction = data?.faction;
        broadcast(ws.currentRoom, 'room:update', room);
    }
}

function handleSetReady(ws, data) {
    const room = rooms.get(ws.currentRoom);
    if (!room) return;
    
    const player = room.players.find(p => p.id === ws.userId);
    if (player) {
        player.isReady = data?.isReady;
        broadcast(ws.currentRoom, 'room:update', room);
    }
}

function handleStartGame(ws) {
    const room = rooms.get(ws.currentRoom);
    if (!room || room.hostId !== ws.userId) return;
    
    room.status = 'playing';
    broadcast(ws.currentRoom, 'game:started', { room });
    broadcastRoomList();
}

function broadcast(roomId, event, data, excludeWs = null) {
    const clients = clientRooms.get(roomId);
    if (!clients) return;
    
    clients.forEach((ws) => {
        if (ws !== excludeWs && ws.readyState === 1) {
            sendMessage(ws, event, data);
        }
    });
}

function broadcastRoomList() {
    const roomList = [];
    rooms.forEach((room) => {
        if (room.status === 'waiting') {
            roomList.push({
                id: room.id,
                name: room.name,
                hostName: room.hostName,
                currentPlayers: room.players.length,
                maxPlayers: room.maxPlayers,
                gameMode: room.gameMode,
                hasPassword: !!room.password
            });
        }
    });
    
    wss.clients.forEach((ws) => {
        if (ws.readyState === 1) {
            sendMessage(ws, 'room:list:update', roomList);
        }
    });
}

setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

httpServer.listen(PORT, () => {
    console.log(`[Server] 三国象棋服务器运行在端口 ${PORT}`);
    console.log(`[Server] HTTP API: http://localhost:${PORT}`);
    console.log(`[Server] WebSocket: ws://localhost:${PORT}/ws`);
});
