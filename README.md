# 📋 AttendCard - 日次出席管理システム

毎日の参加・不参加をメンバーから募る、リアルタイム出席管理システムです。

![AttendCard](https://img.shields.io/badge/Status-Complete-brightgreen) ![Node.js](https://img.shields.io/badge/Node.js-20-green) ![WebSocket](https://img.shields.io/badge/WebSocket-Real--time-blue)

## ✨ 主な機能

### 📊 **リアルタイム出席管理**
- 各メンバーのカード形式表示（名前 + 参加/欠席ボタン）
- 即座のステータス更新（WebSocket通信）
- 視覚的ステータス表示（🟢参加 🔴欠席 ⚪未回答）
- 合計値の自動計算（参加・欠席・未回答・合計）

### 👥 **メンバー管理**
- ➕ **メンバー追加**: 簡単な名前入力で追加
- 🗑️ **メンバー削除**: 確認ダイアログ付きで安全削除
- 出席履歴も含めた完全削除
- リアルタイムでの全クライアント更新

### ⏰ **自動リセット機能**
- **毎日13時に自動リセット** - 全出席データをクリア
- **カウントダウンタイマー** - 次回リセットまでの残り時間表示
- **手動リセット** - タイマークリックで即座にリセット
- 時間に応じた色分け警告（30分前：黄色、5分前：赤色）

### 🎨 **モダンUI/UX**
- レスポンシブデザイン（スマートフォン対応）
- 美しいグラデーションデザイン
- スムーズなアニメーション
- 日本語完全対応

## 🚀 クイックスタート

### 必要環境
- Node.js (v16以上推奨)
- npm

### インストール・起動

1. **クローン・インストール**
   ```bash
   git clone <repository-url>
   cd attendcard
   npm install
   ```

2. **開発サーバー起動**
   ```bash
   npm run dev
   ```

3. **アプリケーション使用**
   - http://localhost:3000 にアクセス
   - データベースと初期メンバーが自動作成されます

### 本番環境デプロイ

```bash
npm start
```

## 🐳 Docker対応

### Docker Composeでの起動

```bash
# データディレクトリ作成
mkdir -p data

# Docker Composeで起動
docker-compose up -d

# ログ確認
docker-compose logs -f
```

## 🏗️ システム構成

### バックエンド (Node.js + Fastify)
```
src/server.js           # メインサーバーファイル
├── Database (SQLite3)
│   ├── members table   # メンバーデータ
│   └── attendance table # 出席記録
├── WebSocket Server    # リアルタイム通信
├── REST API           # CRUD操作
└── Auto-reset Scheduler # 毎日13時自動リセット
```

### フロントエンド (Vanilla JavaScript)
```
public/
├── index.html         # UIコンポーネント
├── app.js            # アプリケーションロジック
└── styles            # 埋め込みCSS
```

### データベース設計

**メンバーテーブル:**
```sql
CREATE TABLE members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**出席テーブル:**
```sql
CREATE TABLE attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER,
    date DATE,
    status TEXT CHECK(status IN ('attend', 'absent')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(member_id) REFERENCES members(id),
    UNIQUE(member_id, date)
);
```

## 🔌 API仕様

| メソッド | エンドポイント | 説明 |
|--------|----------|-------------|
| `GET` | `/api/attendance/today` | 今日の出席データ取得 |
| `POST` | `/api/attendance` | 出席状況更新 |
| `POST` | `/api/attendance/reset` | 今日の出席データリセット |
| `GET` | `/api/members` | 全メンバー取得 |
| `POST` | `/api/members` | 新規メンバー追加 |
| `DELETE` | `/api/members/:id` | メンバー削除 |
| `GET` | `/api/next-reset` | 次回自動リセット時刻取得 |
| `GET` | `/ws` | WebSocket接続 |

## 🎯 使用方法

### 日次ワークフロー
1. **朝**: メンバーが到着し出席状況を入力（参加/欠席）
2. **日中**: 全接続デバイスでリアルタイム更新
3. **13時**: 自動リセットで翌日準備
4. **手動リセット**: 必要時はタイマークリックで即座リセット

### メンバー管理
- **追加**: 「➕ メンバー追加」 → 名前入力 → 自動追加
- **削除**: メンバーカードの🗑️ → 確認 → 削除実行

### マルチデバイス対応
- 複数ユーザー同時アクセス可能
- 全デバイス間でリアルタイム同期
- WebSocketによる即座更新

## 🛠️ 技術スタック

| コンポーネント | 技術 |
|-----------|------------|
| **バックエンド** | Node.js + Fastify |
| **データベース** | SQLite3 |
| **フロントエンド** | Vanilla JavaScript |
| **リアルタイム** | WebSocket |
| **スタイリング** | CSS3（モダン機能使用） |
| **開発** | Nodemon |

## 📂 プロジェクト構造

```
attendcard/
├── src/
│   └── server.js          # バックエンドサーバー
├── public/
│   ├── index.html         # フロントエンドUI
│   └── app.js            # フロントエンドロジック
├── data/
│   └── attendance.db     # SQLiteデータベース（自動作成）
├── docker-compose.yml    # Docker設定
├── Dockerfile           # Dockerイメージ
├── package.json
└── README.md
```

## ⚙️ 設定

### 自動リセット時刻変更
デフォルト: **毎日13時**
- `src/server.js`の`scheduleAutoReset()`関数を修正
- `today13.setHours(13, 0, 0, 0)`を希望時刻に変更

### 初期メンバー設定
デフォルト: 田中, 佐藤, 鈴木, 高橋, 渡辺
- `src/server.js`の`defaultMembers`配列を修正

### サーバーポート変更
デフォルト: **3000**
- `src/server.js`: `fastify.listen({ port: 3000, host: '0.0.0.0' })`を修正

## 🔧 開発

### 利用可能スクリプト
```bash
npm start      # 本番サーバー
npm run dev    # 開発環境（自動リロード）
```

### 主要機能実装詳細

**リアルタイム更新:**
- ページ読み込み時にWebSocket接続確立
- データ変更時に全クライアントへブロードキャスト
- 接続断時の自動再接続

**自動リセットスケジューラー:**
- `setTimeout`による精密なタイミング制御
- リセット後の自動再スケジューリング
- 日付変更の適切な処理

**データ永続化:**
- SQLiteによる信頼性の高いデータ保存
- 外部キー制約によるデータ整合性
- メンバー削除時の自動クリーンアップ

## 🐛 トラブルシューティング

**ポート使用中エラー:**
```bash
pkill -f "node src/server.js"
npm run dev
```

**データベース問題:**
```bash
rm data/attendance.db  # データベースリセット
npm run dev            # デフォルト設定で再作成
```

**WebSocket接続問題:**
- ブラウザコンソールでエラー確認
- サーバーが正しいポートで動作確認
- 必要に応じてブラウザキャッシュクリア

## 📄 ライセンス

MIT License - 自由にプロジェクトで使用可能

## 🤝 コントリビューション

1. リポジトリをフォーク
2. フィーチャーブランチ作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. プルリクエストを作成

---

**効率的な出席管理のために ❤️ で作成**