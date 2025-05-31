#!/bin/bash

# スクリーンセッション名を定義
BACKEND_SESSION="shannon-backend"

# 既存のセッションを確認・終了
screen -X -S $BACKEND_SESSION quit > /dev/null 2>&1

# 既存のNode.jsプロセスを終了
echo "Killing existing Node.js processes..."
pkill -f "node.*npm run dev"
pkill -f "node.*npm run dev:dev"

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
IS_DEV=false
PORT=5000
WS_PORTS=(5010 5011 5012 5013)  # OpenAI, Monitoring, Scheduler, Status
if [ "$1" = "--dev" ]; then
    IS_DEV=true
    PORT=15000
    WS_PORTS=(15010 15011 15012 15013)
    echo "Starting backend in dev mode on port $PORT (WS: ${WS_PORTS[*]})..."
else
    echo "Starting backend on port $PORT (WS: ${WS_PORTS[*]})..."
fi

# 使用するポートをすべて解放
echo "Cleaning up ports..."
kill_port $PORT
for ws_port in "${WS_PORTS[@]}"; do
    kill_port $ws_port
done

# 少し待機して、プロセスが確実に終了するのを待つ
sleep 2

# バックエンドを起動
if [ "$IS_DEV" = true ]; then
    screen -dmS $BACKEND_SESSION bash -c "PORT=$PORT WS_OPENAI_PORT=${WS_PORTS[0]} WS_MONITORING_PORT=${WS_PORTS[1]} WS_SCHEDULER_PORT=${WS_PORTS[2]} WS_STATUS_PORT=${WS_PORTS[3]} npm run dev:dev"
else
    screen -dmS $BACKEND_SESSION bash -c "PORT=$PORT WS_OPENAI_PORT=${WS_PORTS[0]} WS_MONITORING_PORT=${WS_PORTS[1]} WS_SCHEDULER_PORT=${WS_PORTS[2]} WS_STATUS_PORT=${WS_PORTS[3]} npm run dev"
fi
echo "Backend started in screen session: $BACKEND_SESSION"

# セッション情報を表示
echo -e "\nActive screen sessions:"
screen -ls

echo -e "\nTo attach to the session:"
echo "  screen -r $BACKEND_SESSION" 