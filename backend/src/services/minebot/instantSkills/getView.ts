import { CustomBot, InstantSkill } from '../types.js';
import { Vec3 } from 'vec3';
import pkg from 'prismarine-viewer';
const { headless } = pkg;
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import pathfinder from 'mineflayer-pathfinder';
const { goals } = pathfinder;

class GetView extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'get-view';
    this.description = '指定した座標領域が映るようなbot視点の画像を取得します';
    this.params = [
      {
        name: 'startPosition',
        description: '観察したい座標領域の開始座標',
        type: 'Vec3',
        required: true,
      },
      {
        name: 'endPosition',
        description: '観察したい座標領域の終了座標',
        type: 'Vec3',
        required: true,
      },
      {
        name: 'direction',
        description:
          'どの方角から撮影するか。例: north, south, east, west, up, down',
        type: 'string',
        required: false,
      },
    ];
  }

  async run(
    startPosition: Vec3,
    endPosition: Vec3,
    direction: string = 'south'
  ) {
    try {
      // 中心座標を計算
      const centerX = (startPosition.x + endPosition.x) / 2;
      const centerY = (startPosition.y + endPosition.y) / 2;
      const centerZ = (startPosition.z + endPosition.z) / 2;
      const viewCenter = new Vec3(centerX, centerY, centerZ);

      // 領域の大きさを計算
      const dx = Math.abs(startPosition.x - endPosition.x);
      const dy = Math.abs(startPosition.y - endPosition.y);
      const dz = Math.abs(startPosition.z - endPosition.z);
      const maxSize = Math.max(dx, dy, dz);
      const distance = maxSize * 1.5 + 5;

      // 方角ごとにbotの目標座標を計算
      let targetPos: Vec3;
      switch (direction) {
        case 'north':
          targetPos = new Vec3(centerX, centerY, centerZ - distance);
          break;
        case 'south':
          targetPos = new Vec3(centerX, centerY, centerZ + distance);
          break;
        case 'east':
          targetPos = new Vec3(centerX + distance, centerY, centerZ);
          break;
        case 'west':
          targetPos = new Vec3(centerX - distance, centerY, centerZ);
          break;
        case 'up':
          targetPos = new Vec3(centerX, centerY + distance, centerZ);
          break;
        case 'down':
          targetPos = new Vec3(centerX, centerY - distance, centerZ);
          break;
        default:
          targetPos = new Vec3(centerX, centerY, centerZ + distance);
      }

      // botを目標座標に移動させる
      if (this.bot.pathfinder) {
        await this.bot.pathfinder.goto(
          new goals.GoalBlock(targetPos.x, targetPos.y, targetPos.z)
        );
      } else {
        this.bot.entity.position = targetPos;
      }

      // botを領域中心に向かせる
      await this.bot.lookAt(viewCenter);

      // 保存ファイル名を生成
      const timeStamp = new Date().toISOString().replace(/[:.]/g, '-');
      const saveDir = path.join(
        process.cwd(),
        'saves',
        'minecraft',
        'screenshots'
      );
      if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

      // mp4動画として60フレーム保存
      const mp4Name = `view_${timeStamp}.mp4`;
      const mp4Path = path.join(saveDir, mp4Name);
      const pngName = `view_${timeStamp}.png`;
      const pngPath = path.join(saveDir, pngName);
      await headless(this.bot as any, {
        output: mp4Path,
        frames: 20,
        width: 640,
        height: 480,
        jpegOption: undefined,
      });
      await new Promise((resolve) => setTimeout(resolve, 8000));
      // ffmpegでmp4の最後のフレーム（n=19）をpngに変換
      await new Promise((resolve, reject) => {
        exec(
          `ffmpeg -y -i "${mp4Path}" -vf "select=eq(n\\,19)" -vframes 1 "${pngPath}"`,
          (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve(true);
          }
        );
      });
      // mp4一時ファイルを削除
      fs.unlinkSync(mp4Path);
      return {
        success: true,
        result: `視点画像を ${pngPath} に保存しました。`,
      };
    } catch (error: any) {
      return {
        success: false,
        result: `視点画像の取得中にエラーが発生しました: ${error.message}`,
      };
    }
  }
}

export default GetView;
