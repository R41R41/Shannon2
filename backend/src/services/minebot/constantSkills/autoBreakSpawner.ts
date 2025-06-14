import { Vec3 } from 'vec3';
import DigBlock from '../instantSkills/digBlock.js';
import { ConstantSkill, CustomBot } from '../types.js';

class AutoBreakSpawner extends ConstantSkill {
    private digBlock: DigBlock;
    private lastDigTime: number;

    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'auto-break-spawner';
        this.description = '16ブロック以内のスポナーを破壊します';
        this.interval = 1000;
        this.isLocked = false;
        this.priority = 10;
        this.status = true;
        this.containMovement = true;
        this.digBlock = new DigBlock(bot);
        this.lastDigTime = 0;
    }

    async runImpl() {
        try {
            // スポナーを探す
            const spawner = this.bot.findBlock({
                matching: (block) => block.name === 'spawner',
                maxDistance: 16
            });

            if (!spawner) {
                return;
            }

            const now = Date.now();
            // 10秒に1回の頻度で破壊を試みる
            if (now - this.lastDigTime > 10000) {
                const result = await this.digBlock.run(new Vec3(
                    spawner.position.x,
                    spawner.position.y,
                    spawner.position.z
                ));

                if (result.success) {
                    console.log(`\x1b[32m✓ スポナーを破壊しました: ${JSON.stringify(spawner.position)}\x1b[0m`);
                } else {
                    console.log(`\x1b[33m⚠ スポナーの破壊に失敗しました: ${result.result}\x1b[0m`);
                }

                this.lastDigTime = now;
            }
        } catch (error: any) {
            console.error(`スポナー破壊中にエラー: ${error.message}`);
        }
    }
}

export default AutoBreakSpawner; 