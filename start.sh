#!/bin/bash

# スクリーンセッション名を定義
FRONTEND_SESSION="shannon-frontend"
BACKEND_SESSION="shannon-backend"

# 既存のセッションを確認・終了
screen -X -S $FRONTEND_SESSION quit > /dev/null 2>&1
screen -X -S $BACKEND_SESSION quit > /dev/null 2>&1

# テストモードフラグをチェック
IS_TEST=false
if [ "$1" = "--test" ]; then
    IS_TEST=true
    echo "Starting in test mode..."
fi

# バックエンドを起動
cd backend
if [ "$IS_TEST" = true ]; then
    screen -dmS $BACKEND_SESSION bash -c 'xvfb-run -a -s "-ac -screen 0 1280x1024x24" npm run dev:test'
else
    screen -dmS $BACKEND_SESSION bash -c 'xvfb-run -a -s "-ac -screen 0 1280x1024x24" npm run dev'
fi
echo "Backend started in screen session: $BACKEND_SESSION"

# フロントエンドを起動
cd ../frontend
if [ "$IS_TEST" = true ]; then
    screen -dmS $FRONTEND_SESSION bash -c 'npm run dev:test'
else
    screen -dmS $FRONTEND_SESSION bash -c 'npm run dev'
fi
echo "Frontend started in screen session: $FRONTEND_SESSION"

# セッション一覧を表示
echo -e "\nActive screen sessions:"
screen -ls

echo -e "\nTo attach to a session:"
echo "  frontend: screen -r $FRONTEND_SESSION"
echo "  backend:  screen -r $BACKEND_SESSION" 