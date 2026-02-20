#!/bin/bash

# テストモードフラグをチェック
IS_DEV=false
PORT=3000
FRONTEND_SESSION="shannon-frontend"

if [ "$1" = "--dev" ]; then
    IS_DEV=true
    PORT=13000
    FRONTEND_SESSION="shannon-frontend-dev"
    echo "Starting frontend in dev mode on port $PORT..."
else
    echo "Starting frontend on port $PORT..."
fi

# 既存のセッションを確認・終了
tmux kill-session -t $FRONTEND_SESSION 2>/dev/null

# 使用中のポートをチェックして解放
kill_port() {
    local port=$1
    local pid=$(lsof -t -i:${port})
    if [ ! -z "$pid" ]; then
        echo "Killing process using port ${port} (PID: ${pid})"
        kill -9 $pid
    fi
}

# ポートを解放
echo "Cleaning up port ${PORT}..."
kill_port $PORT

# 少し待機
sleep 2

# フロントエンドを起動
if [ "$IS_DEV" = true ]; then
    tmux new-session -d -s $FRONTEND_SESSION "cd /home/azureuser/Shannon-dev/frontend && PORT=$PORT npm run dev:dev"
else
    tmux new-session -d -s $FRONTEND_SESSION "cd /home/azureuser/Shannon-dev/frontend && PORT=$PORT npm run dev"
fi
echo "Frontend started in tmux session: $FRONTEND_SESSION"

# セッション情報を表示
echo -e "\nActive tmux sessions:"
tmux list-sessions

echo -e "\nTo attach to the session:"
echo "  tmux attach -t $FRONTEND_SESSION" 