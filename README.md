# AttendCard

日次出席管理システム

## 機能

- リアルタイム出席管理
- メンバー管理（追加・削除）
- 毎日13時自動リセット
- WebSocket通信

## デプロイ

```bash
# TUNNEL_TOKENを設定
export TUNNEL_TOKEN=your_token

# 起動
docker-compose up -d
```

## 開発

```bash
npm install
npm run dev
```

http://localhost:3000