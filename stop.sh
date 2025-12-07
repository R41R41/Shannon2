#!/bin/bash

# セッション名を定義
FRONTEND_SESSION="shannon-frontend"
BACKEND_SESSION="shannon-backend"
FRONTEND_SESSION_DEV="shannon-frontend-dev"
BACKEND_SESSION_DEV="shannon-backend-dev"

# 既存のセッションを確認・終了
tmux kill-session -t $FRONTEND_SESSION 2>/dev/null
tmux kill-session -t $BACKEND_SESSION 2>/dev/null
tmux kill-session -t $FRONTEND_SESSION_DEV 2>/dev/null
tmux kill-session -t $BACKEND_SESSION_DEV 2>/dev/null

echo "All sessions stopped."

# セッション一覧を表示
echo -e "\nActive tmux sessions:"
tmux list-sessions 2>/dev/null || echo "No active sessions"