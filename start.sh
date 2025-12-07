#!/bin/bash

# セッション名を定義
FRONTEND_SESSION="shannon-frontend"
BACKEND_SESSION="shannon-backend"

# テストモードフラグをチェック
IS_DEV=false
if [ "$1" = "--dev" ]; then
    IS_DEV=true
    BACKEND_SESSION="$BACKEND_SESSION-dev"
    FRONTEND_SESSION="$FRONTEND_SESSION-dev"
    echo "Starting in dev mode..."
fi

# 既存のセッションを確認・終了
tmux kill-session -t $FRONTEND_SESSION 2>/dev/null
tmux kill-session -t $BACKEND_SESSION 2>/dev/null

# バックエンドを起動
cd backend
if [ "$IS_DEV" = true ]; then
    ./start.sh --dev
else
    ./start.sh
fi

# フロントエンドを起動
cd ../frontend
if [ "$IS_DEV" = true ]; then
    ./start.sh --dev
else
    ./start.sh
fi

# セッション一覧を表示
echo -e "\nActive tmux sessions:"
tmux list-sessions

echo -e "\nTo attach to a session:"
echo "  frontend: tmux attach -t $FRONTEND_SESSION"
echo "  backend:  tmux attach -t $BACKEND_SESSION" 