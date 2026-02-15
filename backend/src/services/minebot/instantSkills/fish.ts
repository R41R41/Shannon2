import { CustomBot, InstantSkill } from '../types.js';
import { Vec3 } from 'vec3';

/**
 * 原子的スキル: 釣りをする
 * mineflayerの bot.fish() を使用
 * 自動でキャスト→アタリ待ち→リールインを行う
 * 水面を自動検出し、適切な角度で投げる
 */
class Fish extends InstantSkill {
  /**
   * 世代カウンター: runImpl() の並行実行を防ぐ。
   * 新しい runImpl() が開始されると世代が上がり、
   * 古い runImpl() はループ内で世代の変化を検出して自発的に終了する。
   */
  private runGeneration = 0;

  /**
   * 現在のmonkey-patchの解除関数。
   * 二重パッチを防ぐために保持する。
   */
  private unpatchFn: (() => void) | null = null;

  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'fish';
    this.description =
      '釣りをします。釣り竿を装備して、指定回数だけ釣りを繰り返します。水辺にいる必要があります。自動的に水面を検出して適切な方向を向きます。';
    this.params = [
      {
        name: 'count',
        type: 'number',
        description: '釣りを行う回数（デフォルト: 1）',
        default: 1,
        required: false,
      },
    ];
  }

  /**
   * 釣りに適した水面ブロックを見つける
   * 釣りの投射体（ボバー）は放物線を描くため、水平距離3〜8ブロックが最適。
   * 近すぎると足元ブロックに当たって Fishing cancelled になる。
   */
  private findBestWaterSurface(): Vec3 | null {
    const botPos = this.bot.entity.position;
    const eyePos = botPos.offset(0, 1.62, 0);

    // 周囲の水ブロックを検索（少し広めに）
    const waterPositions = (this.bot as any).findBlocks({
      matching: (block: any) => block.name === 'water',
      maxDistance: 15,
      count: 100,
    }) as Vec3[];

    if (!waterPositions || waterPositions.length === 0) return null;

    // 水面ブロック（上がair）を収集し、水平距離を計算
    const surfaceBlocks: { pos: Vec3; totalDist: number; horizontalDist: number }[] = [];

    for (const pos of waterPositions) {
      const aboveBlock = this.bot.blockAt(pos.offset(0, 1, 0));
      if (!aboveBlock || aboveBlock.name !== 'air') continue;

      const waterCenter = pos.offset(0.5, 0.5, 0.5);
      const dx = waterCenter.x - eyePos.x;
      const dz = waterCenter.z - eyePos.z;
      const horizontalDist = Math.sqrt(dx * dx + dz * dz);
      const totalDist = eyePos.distanceTo(waterCenter);
      surfaceBlocks.push({ pos, totalDist, horizontalDist });
    }

    if (surfaceBlocks.length === 0) return null;

    // 釣りボバーは放物線を描くため、近い水面の方が着水しやすい
    // 最適: 2〜4ブロック、OK: 1.5〜6ブロック、フォールバック: 1ブロック以上
    const idealBlocks = surfaceBlocks.filter(b => b.horizontalDist >= 2 && b.horizontalDist <= 4);
    const okBlocks = surfaceBlocks.filter(b => b.horizontalDist >= 1.5 && b.horizontalDist <= 6);
    const fallbackBlocks = surfaceBlocks.filter(b => b.horizontalDist >= 1);

    const candidateGroups = [idealBlocks, okBlocks, fallbackBlocks, surfaceBlocks];

    for (const group of candidateGroups) {
      if (group.length === 0) continue;

      // 水平距離が最適範囲の中心(3m)に近い順にソート
      group.sort((a, b) => Math.abs(a.horizontalDist - 3) - Math.abs(b.horizontalDist - 3));

      // 視線が通る水面を選択
      for (const candidate of group) {
        if (candidate.totalDist > 15) continue;
        const target = candidate.pos.offset(0.5, 0.5, 0.5);
        if (this.hasLineOfSight(eyePos, target)) {
          console.log(`\x1b[36m🎣 水面選択: 水平距離=${candidate.horizontalDist.toFixed(1)}m, 総距離=${candidate.totalDist.toFixed(1)}m\x1b[0m`);
          return candidate.pos;
        }
      }
    }

    // 視線が通る水面がなかった場合、最も近い水面をフォールバック
    console.log(`\x1b[33m⚠ 視線が通る水面がないため、最寄り水面を使用\x1b[0m`);
    surfaceBlocks.sort((a, b) => a.totalDist - b.totalDist);
    return surfaceBlocks[0].pos;
  }

  /**
   * 2点間に固体ブロック（water/air以外）がないかチェック
   */
  private hasLineOfSight(from: Vec3, to: Vec3): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const steps = Math.ceil(dist * 2); // 0.5ブロック間隔

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const checkPos = from.offset(dx * t, dy * t, dz * t);
      const block = this.bot.blockAt(checkPos);
      if (block && block.name !== 'air' && block.name !== 'water' && block.name !== 'cave_air') {
        return false;
      }
    }
    return true;
  }

  /**
   * mineflayer の use_item パケットの rotation バグを修正するモンキーパッチ。
   *
   * 問題: mineflayer の activateItem() は use_item パケットの rotation を
   * { x: 0, y: 0 } にハードコードしている（inventory.js 131行目）。
   * Minecraft 1.21.2+ ではサーバーがこの rotation を使ってキャスト方向を判定するため、
   * 常に南向き水平（yaw=0, pitch=0）にキャストされてしまう。
   *
   * 修正: _client.write をラップして、use_item パケットの rotation を
   * ボットの実際の向き（Notchian形式）に差し替える。
   */
  private patchActivateItemRotation(): () => void {
    // 既にパッチ済みならそのまま返す（二重パッチ防止）
    if (this.unpatchFn) return this.unpatchFn;

    const client = (this.bot as any)._client;
    const origWrite = client.write.bind(client);
    const bot = this.bot;

    client.write = function (name: string, data: any, ...rest: any[]) {
      if (name === 'use_item' && data && data.rotation) {
        // mineflayer内部(ラジアン) → Notchian(度) に変換
        // toNotchianYaw(yaw)  = degrees(π - yaw)
        // toNotchianPitch(pitch) = degrees(-pitch)
        const notchYaw = (180 / Math.PI) * (Math.PI - bot.entity.yaw);
        const notchPitch = (180 / Math.PI) * (-bot.entity.pitch);
        data.rotation = { x: notchYaw, y: notchPitch };
        console.log(
          `\x1b[35m🔧 use_item rotation修正: yaw=${notchYaw.toFixed(1)}° pitch=${notchPitch.toFixed(1)}°\x1b[0m`,
        );
      }
      return origWrite(name, data, ...rest);
    };

    // パッチ解除用の関数を返す
    this.unpatchFn = () => {
      client.write = origWrite;
      this.unpatchFn = null;
    };
    return this.unpatchFn;
  }

  async runImpl(count: number = 1) {
    // 世代をインクリメント: 古い runImpl() がまだ動いていたら
    // ループ内で世代変化を検出して自発的に終了する
    const myGeneration = ++this.runGeneration;

    try {
      // 前回の中断された釣り操作をキャンセル
      try {
        this.bot.deactivateItem();
      } catch (_) { /* ignore */ }
      await this.bot.waitForTicks(5);

      // 釣り竿を持っているかチェック
      const fishingRod = this.bot.inventory
        .items()
        .find((item) => item.name === 'fishing_rod');

      if (!fishingRod) {
        return {
          success: false,
          result:
            '釣り竿を持っていません。fishing_rod をクラフトするか入手してください。',
        };
      }

      // 釣り竿を装備
      await this.bot.equip(fishingRod, 'hand');
      await this.bot.waitForTicks(5);

      // use_item パケットの rotation バグを修正
      const unpatch = this.patchActivateItemRotation();

      // 水面ターゲットを検出
      let aimTarget: Vec3 | null = null;

      const waterSurface = this.findBestWaterSurface();
      if (!waterSurface) {
        const anyWater = this.bot.findBlock({
          matching: (block: any) => block.name === 'water',
          maxDistance: 10,
        });
        if (!anyWater) {
          unpatch();
          return {
            success: false,
            result:
              '近くに水が見つかりません。水辺に移動してください（10ブロック以内）。',
          };
        }
        console.log(
          `\x1b[33m⚠ 視線が通る水面がなく、最寄りの水ブロックに向きます: ${anyWater.position}\x1b[0m`,
        );
        aimTarget = anyWater.position.offset(0.5, 0.5, 0.5);
      } else {
        aimTarget = waterSurface.offset(0.5, 0.5, 0.5);
      }

      const caughtItems: string[] = [];
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < count; i++) {
        // ── 毎回キャスト前に照準を再設定 ──
        // （前回のキャストやリールインで方向がずれる可能性があるため）
        const eyePos = this.bot.entity.position.offset(0, 1.62, 0);
        const dx = aimTarget.x - eyePos.x;
        const dy = aimTarget.y - eyePos.y;
        const dz = aimTarget.z - eyePos.z;
        const horizontalDist = Math.sqrt(dx * dx + dz * dz);

        // ボバー弧補正: 水面より下を狙って放物線で着水させる
        const arcCompensation = 1.5 + horizontalDist * 0.4;
        const compensatedTarget = new Vec3(
          aimTarget.x,
          aimTarget.y - arcCompensation,
          aimTarget.z,
        );

        if (i === 0) {
          // 初回のみ詳細ログ
          const directPitchDeg = Math.round(
            Math.atan2(-dy, horizontalDist) * (180 / Math.PI),
          );
          const fishingPitchDeg = Math.round(
            Math.atan2(
              -(compensatedTarget.y - eyePos.y),
              horizontalDist,
            ) *
              (180 / Math.PI),
          );
          console.log(
            `\x1b[36m🎯 自動照準: 水面ターゲット (${aimTarget.x.toFixed(1)}, ${aimTarget.y.toFixed(1)}, ${aimTarget.z.toFixed(1)}) dist=${eyePos.distanceTo(aimTarget).toFixed(1)}m 水平=${horizontalDist.toFixed(1)}m\x1b[0m`,
          );
          console.log(
            `\x1b[36m🎯 ボバー弧補正: pitch=${directPitchDeg}°→${fishingPitchDeg}° (補正=${arcCompensation.toFixed(1)}m下)\x1b[0m`,
          );
        }

        // lookAt で方向設定 (force=true でパケット即送信)
        await this.bot.lookAt(compensatedTarget, true);
        // サーバーに方向が確実に届くよう少し待つ
        await this.bot.waitForTicks(5);
        // 中断チェック1: 基底クラスの shouldInterrupt()
        // 中断チェック2: 世代が変わった場合（新しい runImpl() が開始された）
        if (this.shouldInterrupt() || myGeneration !== this.runGeneration) {
          const reason = myGeneration !== this.runGeneration ? '新しいタスクにより' : 'フィードバックにより';
          console.log(`\x1b[33m⚡ 釣りループ終了: ${reason}中断（${successCount}/${i}回完了）\x1b[0m`);
          // 世代が変わった場合は unpatch しない（新しい runImpl が使っている）
          if (myGeneration === this.runGeneration) unpatch();
          return {
            success: successCount > 0,
            result: successCount > 0
              ? `中断。${successCount}/${i}回成功: ${caughtItems.join(', ')}`
              : `中断（${i}回試行、成功なし）`,
          };
        }

        try {
          console.log(
            `\x1b[36m🎣 釣り ${i + 1}/${count} 回目: キャスト中...\x1b[0m`
          );

          // playerCollect イベントで釣れたアイテムを検出
          const collectPromise = new Promise<string>((resolve) => {
            const timeout = setTimeout(() => {
              this.bot.removeListener('playerCollect', onCollect);
              resolve('unknown');
            }, 60000); // 60秒タイムアウト

            const onCollect = (collector: any, collected: any) => {
              if (collector.username === this.bot.username) {
                clearTimeout(timeout);
                this.bot.removeListener('playerCollect', onCollect);
                // collected entity からアイテム名を取得
                const itemName =
                  collected.metadata?.[8]?.itemId
                    ? this.bot.registry.items[collected.metadata[8].itemId]
                        ?.name || 'item'
                    : 'item';
                resolve(itemName);
              }
            };
            this.bot.on('playerCollect', onCollect);
          });

          // bot.fish() はキャスト→待機→リールインを全自動で行う
          // ただし mineflayer の fish() にはタイムアウトがないため、
          // ボバーが想定外の状態（プレイヤーにフック等）になると永久にハングする。
          // 60秒タイムアウトで強制リールインする。
          const FISH_TIMEOUT_MS = 60000;
          const fishPromise = (this.bot as any).fish();
          const fishTimeoutPromise = new Promise<never>((_, reject) => {
            const timer = setTimeout(() => {
              // タイムアウト: 釣り竿をリールインして状態をリセット
              try {
                this.bot.activateItem(); // リールイン（トグル）
              } catch (_) { /* ignore */ }
              reject(new Error('Fishing timeout (60s) - ボバーが異常状態の可能性'));
            }, FISH_TIMEOUT_MS);
            // fish が正常完了したらタイマーをクリア
            fishPromise.then(() => clearTimeout(timer)).catch(() => clearTimeout(timer));
          });

          await Promise.race([fishPromise, fishTimeoutPromise]);

          // 釣れたアイテムを記録（少し待ってからcollectイベントを確認）
          const itemName = await Promise.race([
            collectPromise,
            new Promise<string>((resolve) =>
              setTimeout(() => resolve('item'), 2000)
            ),
          ]);

          caughtItems.push(itemName);
          successCount++;
          console.log(
            `\x1b[32m✓ 釣り ${i + 1}/${count}: ${itemName} を釣り上げた！\x1b[0m`
          );

          // 次のキャストまで少し待つ
          if (i < count - 1) {
            await this.bot.waitForTicks(20);
          }
        } catch (e: any) {
          failCount++;
          console.log(
            `\x1b[33m⚠ 釣り ${i + 1}/${count}: 失敗 - ${e.message}\x1b[0m`
          );

          // 中断シグナルまたは世代変化ならループを即終了
          if (this.shouldInterrupt() || myGeneration !== this.runGeneration) {
            if (myGeneration === this.runGeneration) unpatch();
            return {
              success: successCount > 0,
              result: successCount > 0
                ? `中断。${successCount}/${i + 1}回成功: ${caughtItems.join(', ')}`
                : `中断（${i + 1}回試行、成功なし）`,
            };
          }

          // 釣り竿の耐久が尽きた場合
          const currentRod = this.bot.inventory
            .items()
            .find((item) => item.name === 'fishing_rod');
          if (!currentRod) {
            unpatch();
            return {
              success: successCount > 0,
              result:
                successCount > 0
                  ? `釣り竿が壊れました。${successCount}回成功: ${caughtItems.join(', ')}`
                  : '釣り竿が壊れました。新しい釣り竿が必要です。',
            };
          }

          // 少し待ってリトライ
          await this.bot.waitForTicks(20);
        }
      }

      // パッチ解除（世代が変わっていなければ）
      if (myGeneration === this.runGeneration) unpatch();

      if (successCount === 0) {
        return {
          success: false,
          result: `${count}回試みましたが、何も釣れませんでした。`,
        };
      }

      // アイテムの集計
      const itemCounts: Record<string, number> = {};
      for (const item of caughtItems) {
        itemCounts[item] = (itemCounts[item] || 0) + 1;
      }
      const summary = Object.entries(itemCounts)
        .map(([name, cnt]) => `${name} x${cnt}`)
        .join(', ');

      return {
        success: true,
        result: `${count}回中${successCount}回成功！釣果: ${summary}`,
      };
    } catch (error: any) {
      return { success: false, result: `釣りエラー: ${error.message}` };
    }
  }
}

export default Fish;
