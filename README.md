# AttendCard - 出席管理システム

毎日の参加・不参加をメンバーから募る出席管理システムです。

## 機能

- 📊 **リアルタイム集計**: 参加・欠席・未回答の合計値をトップに表示
- 👥 **メンバーカード**: 各メンバーの名前と参加/不参加ボタン
- 🔄 **リアルタイム更新**: WebSocketによる即座の画面更新
- 📱 **レスポンシブデザイン**: スマートフォン対応
- 🐳 **Docker対応**: 簡単なデプロイメント

## Docker Composeでの起動

```bash
# リポジトリをクローン
git clone <repository-url>
cd attendcard

# データディレクトリを作成
mkdir -p data

# Docker Composeで起動
docker-compose up -d

# ログを確認
docker-compose logs -f
```

アプリケーションは http://localhost:3000 でアクセスできます。

## 開発環境での起動

```bash
# 依存関係をインストール
npm install

# 開発サーバーを起動
npm run dev
```

## 環境

- Node.js 20
- Fastify (Webフレームワーク)
- SQLite (データベース)
- WebSocket (リアルタイム通信)

## データベース

SQLiteを使用しており、以下のテーブルが自動作成されます：

- `members`: メンバー情報
- `attendance`: 出席記録

初回起動時にデフォルトメンバー（田中、佐藤、鈴木、高橋、渡辺）が自動追加されます。