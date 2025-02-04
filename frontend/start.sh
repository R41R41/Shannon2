#!/bin/bash

# スクリーンセッション名を定義
FRONTEND_SESSION="shannon-frontend"

# 既存のセッションを確認・終了
screen -X -S $FRONTEND_SESSION quit > /dev/null 2>&1

# 既存のNode.jsプロセスを終了
echo "Killing existing Node.js processes..."
pkill -f "node.*npm run dev"
pkill -f "node.*npm run dev:test"

# 使用中のポートをチェックして解放
kill_port() {
    local port=$1
    local pid=$(lsof -t -i:${port})
    if [ ! -z "$pid" ]; then
        echo "Killing process using port ${port} (PID: ${pid})"
        kill -9 $pid
    fi
}

# テストモードフラグをチェック
IS_TEST=false
PORT=3000
if [ "$1" = "--test" ]; then
    IS_TEST=true
    PORT=13000
    echo "Starting frontend in test mode on port $PORT..."
else
    echo "Starting frontend on port $PORT..."
fi

# ポートを解放
echo "Cleaning up port ${PORT}..."
kill_port $PORT

# 少し待機
sleep 2

# フロントエンドを起動
if [ "$IS_TEST" = true ]; then
    screen -dmS $FRONTEND_SESSION bash -c "PORT=$PORT npm run dev:test"
else
    screen -dmS $FRONTEND_SESSION bash -c "PORT=$PORT npm run dev"
fi
echo "Frontend started in screen session: $FRONTEND_SESSION"

# セッション情報を表示
echo -e "\nActive screen sessions:"
screen -ls

echo -e "\nTo attach to the session:"
echo "  screen -r $FRONTEND_SESSION" 