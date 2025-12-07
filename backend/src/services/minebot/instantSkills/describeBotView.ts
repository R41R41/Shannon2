import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { CONFIG } from '../config/MinebotConfig.js';
import { CustomBot, InstantSkill } from '../types.js';
import { SkillParam } from '../types/skillParams.js';

/**
 * Bot視点の画像を取得して説明するスキル
 * ShannonUIModのクライアントHTTPサーバーからスクリーンショットを取得し、
 * GPT-4Vで画像を分析して説明を生成する
 */
class DescribeBotView extends InstantSkill {
  skillName = 'describe-bot-view';
  description =
    'ボットの視点（Minecraftクライアントの画面）を取得し、何が見えているかを説明します。方向を指定すると、その方向を向いてからスクリーンショットを撮影します。';
  params: SkillParam[] = [
    {
      name: 'context',
      type: 'string' as const,
      description:
        '分析の観点（例: "建築物を分析して", "敵がいるか確認", "周囲の地形を説明して"）',
      required: false,
    },
    {
      name: 'direction',
      type: 'string' as const,
      description:
        '見る方向。"north", "south", "east", "west", "up", "down", "current"（現在の方向）、または角度（例: "45"でyaw=45°）。デフォルトは"current"',
      default: 'current',
    },
    {
      name: 'pitch',
      type: 'number' as const,
      description:
        '上下の角度（-90〜90）。-90で真上、0で水平、90で真下。directionで"up"/"down"を指定した場合は無視されます。デフォルトは0（水平）',
      default: 0,
    },
    {
      name: 'width',
      type: 'number' as const,
      description: '画像の幅（リサイズ、デフォルト: 512）',
      default: 512,
    },
    {
      name: 'height',
      type: 'number' as const,
      description: '画像の高さ（リサイズ、デフォルト: 512）',
      default: 512,
    },
  ];
  isToolForLLM = true;

  private visionModel: ChatOpenAI;

  constructor(bot: CustomBot) {
    super(bot);
    // GPT-4 Visionモデルを使用
    this.visionModel = new ChatOpenAI({
      modelName: 'gpt-4o',
      temperature: 0.1,
      apiKey: CONFIG.OPENAI_API_KEY,
      maxTokens: 1000,
    });
  }

  async runImpl(
    context: string = '',
    direction: string = 'current',
    pitch: number = 0,
    width: number = 512,
    height: number = 512
  ) {
    try {
      // 方向が指定されている場合、その方向を向く
      if (direction !== 'current') {
        const lookResult = await this.lookInDirection(direction, pitch);
        if (!lookResult.success) {
          return {
            success: false,
            result: `視線変更失敗: ${lookResult.error}`,
          };
        }
        console.log(`👁️ ${lookResult.direction}を向きました`);

        // 視線変更がMinecraftクライアントに反映されるまで少し待機
        await this.sleep(300);
      }

      console.log('📸 Bot視点のスクリーンショットを取得中...');

      // ShannonUIModからスクリーンショットを取得
      const screenshot = await this.fetchScreenshot(width, height);

      if (!screenshot.success) {
        return {
          success: false,
          result: `スクリーンショット取得失敗: ${screenshot.error}`,
        };
      }

      console.log(
        `✅ スクリーンショット取得完了: ${screenshot.width}x${screenshot.height}`
      );

      // GPT-4Vで画像を分析
      const description = await this.analyzeImage(
        screenshot.image,
        context,
        screenshot.playerPosition,
        screenshot.playerRotation
      );

      return {
        success: true,
        result: description,
      };
    } catch (error: any) {
      console.error('Bot視点分析エラー:', error);
      return {
        success: false,
        result: `エラー: ${error.message}`,
      };
    }
  }

  /**
   * 指定された方向を向く
   */
  private async lookInDirection(
    direction: string,
    pitch: number = 0
  ): Promise<{ success: boolean; direction?: string; error?: string }> {
    try {
      let yaw: number;
      let finalPitch: number = pitch;
      let directionName: string;

      // 方向をyaw角度に変換
      // Minecraftのyaw: 南=0, 西=90, 北=180/-180, 東=-90/270
      switch (direction.toLowerCase()) {
        case 'north':
        case 'n':
          yaw = 180;
          directionName = '北';
          break;
        case 'south':
        case 's':
          yaw = 0;
          directionName = '南';
          break;
        case 'east':
        case 'e':
          yaw = -90;
          directionName = '東';
          break;
        case 'west':
        case 'w':
          yaw = 90;
          directionName = '西';
          break;
        case 'northeast':
        case 'ne':
          yaw = -135;
          directionName = '北東';
          break;
        case 'northwest':
        case 'nw':
          yaw = 135;
          directionName = '北西';
          break;
        case 'southeast':
        case 'se':
          yaw = -45;
          directionName = '南東';
          break;
        case 'southwest':
        case 'sw':
          yaw = 45;
          directionName = '南西';
          break;
        case 'up':
          yaw = this.bot.entity.yaw * (180 / Math.PI); // 現在のyawを維持
          finalPitch = -90;
          directionName = '上';
          break;
        case 'down':
          yaw = this.bot.entity.yaw * (180 / Math.PI); // 現在のyawを維持
          finalPitch = 90;
          directionName = '下';
          break;
        default:
          // 数値として解釈（yaw角度）
          const parsedYaw = parseFloat(direction);
          if (!isNaN(parsedYaw)) {
            yaw = parsedYaw;
            directionName = `yaw=${parsedYaw}°`;
          } else {
            return {
              success: false,
              error: `不明な方向: ${direction}。north/south/east/west/up/down または角度を指定してください。`,
            };
          }
      }

      // pitchを制限（-90〜90）
      finalPitch = Math.max(-90, Math.min(90, finalPitch));

      // ラジアンに変換してbotの視線を変更
      const yawRad = (yaw * Math.PI) / 180;
      const pitchRad = (finalPitch * Math.PI) / 180;

      await this.bot.look(yawRad, pitchRad, true);

      return {
        success: true,
        direction: directionName,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 指定ミリ秒待機
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * ShannonUIModからスクリーンショットを取得（MODサーバー経由）
   * ボットの視点から撮影
   */
  private async fetchScreenshot(
    width: number,
    height: number
  ): Promise<ScreenshotResponse> {
    try {
      // ボットの位置と向きを取得
      const botPosition = this.bot.entity?.position || { x: 0, y: 0, z: 0 };
      const botYaw = this.bot.entity?.yaw || 0;
      const botPitch = this.bot.entity?.pitch || 0;
      const botName = this.bot.username || 'Shannon';

      // yawをラジアンから度に変換（Minecraft: 南=0, 西=90, 北=180, 東=-90）
      const yawDegrees = (botYaw * 180) / Math.PI;
      const pitchDegrees = (botPitch * 180) / Math.PI;

      console.log(`📸 Requesting screenshot from bot view: ${botName} at (${botPosition.x.toFixed(1)}, ${botPosition.y.toFixed(1)}, ${botPosition.z.toFixed(1)}) yaw=${yawDegrees.toFixed(1)}°`);

      // MODサーバー経由でスクリーンショットを取得（パケットでクライアントに転送される）
      const response = await fetch(
        `${CONFIG.UI_MOD_BASE_URL}/screenshot`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            width,
            height,
            botName,
            botX: botPosition.x,
            botY: botPosition.y + 1.62, // 目の高さ
            botZ: botPosition.z,
            botYaw: yawDegrees,
            botPitch: pitchDegrees,
          }),
        }
      );

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          image: '',
          width: 0,
          height: 0,
        };
      }

      const data = await response.json();
      return data as ScreenshotResponse;
    } catch (error: any) {
      return {
        success: false,
        error: `接続エラー: ${error.message}。ShannonUIMod Minecraftサーバーに接続できません。`,
        image: '',
        width: 0,
        height: 0,
      };
    }
  }

  /**
   * GPT-4Vで画像を分析
   */
  private async analyzeImage(
    base64Image: string,
    context: string,
    playerPosition?: { x: number; y: number; z: number },
    playerRotation?: { yaw: number; pitch: number }
  ): Promise<string> {
    // ポジション情報をコンテキストに追加
    let positionInfo = '';
    if (playerPosition) {
      positionInfo = `\nプレイヤー位置: (${playerPosition.x}, ${playerPosition.y}, ${playerPosition.z})`;
    }
    if (playerRotation) {
      const direction = this.getDirection(playerRotation.yaw);
      positionInfo += `\n向いている方向: ${direction} (yaw: ${playerRotation.yaw.toFixed(
        1
      )}°, pitch: ${playerRotation.pitch.toFixed(1)}°)`;
    }

    const systemPrompt = `あなたはMinecraftの画像を分析するAIアシスタントです。
プレイヤーの視点から見た画面を分析し、何が見えているかを詳細に説明してください。

分析のポイント:
- 見えているブロックの種類と配置
- 地形の特徴（平地、山、洞窟、水辺など）
- 建築物や人工構造物の有無
- モブやエンティティの存在
- 明るさや時間帯
- 遠景の特徴

回答は日本語で、具体的かつ簡潔に。
数値や方角を含めると、より役立つ情報になります。
${positionInfo}`;

    const userPrompt = context
      ? `この画像を分析してください。特に次の点に注目: ${context}`
      : 'この画像を分析して、何が見えているか説明してください。';

    try {
      const response = await this.visionModel.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage({
          content: [
            { type: 'text', text: userPrompt },
            {
              type: 'image_url',
              image_url: {
                url: base64Image,
                detail: 'low', // トークン節約のため low detail
              },
            },
          ],
        }),
      ]);

      return response.content.toString();
    } catch (error: any) {
      console.error('画像分析エラー:', error);
      throw new Error(`画像分析に失敗: ${error.message}`);
    }
  }

  /**
   * Yaw角度から方角を取得
   */
  private getDirection(yaw: number): string {
    // Minecraftのyawは南が0°、西が90°、北が180°、東が-90°
    const normalizedYaw = ((yaw % 360) + 360) % 360;

    if (normalizedYaw >= 315 || normalizedYaw < 45) {
      return '南';
    } else if (normalizedYaw >= 45 && normalizedYaw < 135) {
      return '西';
    } else if (normalizedYaw >= 135 && normalizedYaw < 225) {
      return '北';
    } else {
      return '東';
    }
  }
}

// 型定義
interface ScreenshotResponse {
  success: boolean;
  image: string;
  width: number;
  height: number;
  playerPosition?: { x: number; y: number; z: number };
  playerRotation?: { yaw: number; pitch: number };
  error?: string;
}

export default DescribeBotView;
