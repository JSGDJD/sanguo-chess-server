# 三国象棋服务器

## 本地运行

```bash
npm install
npm start
```

## Railway 部署

1. 将此目录推送到 GitHub
2. 在 Railway 中创建新项目
3. 选择 GitHub 仓库
4. 自动部署

## API 端点

- `GET /` - 服务器状态
- `GET /api/health` - 健康检查
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录
- `GET /api/user/profile` - 获取用户信息
- `PUT /api/user/profile` - 更新用户资料
- `PUT /api/user/password` - 修改密码

## WebSocket 事件

- `auth` - 认证
- `room:create` - 创建房间
- `room:list` - 获取房间列表
- `room:join` - 加入房间
- `room:leave` - 离开房间
- `player:faction` - 选择阵营
- `player:ready` - 准备
- `game:start` - 开始游戏
