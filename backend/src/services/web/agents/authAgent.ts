import {
  WebSocketServiceBase,
  WebSocketServiceConfig,
} from '../../common/WebSocketService.js';
import { User } from '../../../models/User.js';

export class AuthAgent extends WebSocketServiceBase {
  private static instance: AuthAgent;

  private constructor(config: WebSocketServiceConfig) {
    super(config);
  }

  public static getInstance(config: WebSocketServiceConfig): AuthAgent {
    if (!AuthAgent.instance) {
      AuthAgent.instance = new AuthAgent(config);
    }
    return AuthAgent.instance;
  }

  protected override initialize() {
    if (this.wss) {
      this.wss.clients.forEach((client) => {
        client.close();
      });
    }

    this.wss.on('connection', async (ws) => {
      console.log('\x1b[34mAuth client connected\x1b[0m');

      ws.on('close', () => {
        console.log('\x1b[31mAuth client disconnected\x1b[0m');
      });

      ws.on('message', async (message) => {
        const data = JSON.parse(message.toString());

        if (data.type === 'auth:init') {
          try {
            // 既存ユーザーチェック
            const existingUser = await User.findOne({ email: data.email });
            if (existingUser) {
              console.log('User already exists:', existingUser);
              ws.send(
                JSON.stringify({
                  type: 'auth:init_response',
                  success: false,
                  error: 'User already exists',
                })
              );
              return;
            }

            // emailをユニークにする（スキーマレベル）
            const user = await User.create({
              name: data.name,
              email: data.email,
              isAuthorized: true,
              isAdmin: true,
              createdAt: new Date(),
            });
            console.log('Initial user created:', user);
            ws.send(
              JSON.stringify({
                type: 'auth:init_response',
                success: true,
              })
            );
          } catch (error) {
            console.error('User creation error:', error);
            ws.send(
              JSON.stringify({
                type: 'auth:init_response',
                success: false,
                error: 'Failed to create user',
              })
            );
          }
        }

        if (data.type === 'ping') {
          this.broadcast({ type: 'pong' });
          return;
        }

        if (data.type === 'auth:check') {
          console.log('Auth check received', data.email);
          try {
            const query = { email: data.email, isAuthorized: true };
            const user = await User.findOne(query).lean();
            ws.send(
              JSON.stringify({
                type: 'auth:response',
                success: !!user,
                userData: user
                  ? {
                      name: user.name,
                      email: user.email,
                      isAdmin: user.isAdmin,
                    }
                  : null,
              })
            );
          } catch (error) {
            console.error('Auth check error:', error);
            ws.send(
              JSON.stringify({
                type: 'auth:response',
                success: false,
                error: 'Server error',
              })
            );
          }
        }
      });

      ws.on('close', () => {
        console.log('\x1b[31mAuth Client disconnected\x1b[0m');
      });
    });
  }
}
