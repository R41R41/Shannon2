import { Vec3 } from 'vec3';
import { CustomBot, InstantSkill } from '../types.js';

class UseFurnace extends InstantSkill {
    constructor(bot: CustomBot) {
        super(bot);
        this.skillName = 'use-furnace';
        this.description = 'かまどを使ってアイテムを精錬します。';
        this.bot = bot;
        this.params = [
            {
                name: 'furnacePosition',
                type: 'Vec3',
                description: 'かまどの座標',
                required: true,
            },
            {
                name: 'inputItemName',
                type: 'string',
                description: '精錬する素材の名前（例: iron_ore, raw_iron など）',
                required: true,
            },
            {
                name: 'inputAmount',
                type: 'number',
                description: '精錬する素材の数',
                required: true,
            },
            {
                name: 'fuelItemName',
                type: 'string',
                description: '燃料の名前（例: coal, charcoal, planks など）',
                required: true,
            },
            {
                name: 'fuelAmount',
                type: 'number',
                description: '燃料の数',
                required: true,
            },
            {
                name: 'waitForCompletion',
                type: 'boolean',
                description: '精錬が完了するまで待つかどうか（デフォルト: false）',
                required: false,
                default: false,
            },
        ];
        this.canUseByCommand = false;
    }

    async runImpl(
        furnacePosition: Vec3,
        inputItemName: string,
        inputAmount: number,
        fuelItemName: string,
        fuelAmount: number,
        waitForCompletion: boolean = false
    ) {
        try {
            // かまどの確認
            const block = this.bot.blockAt(furnacePosition);
            if (
                !block ||
                !(
                    block.name === 'furnace' ||
                    block.name === 'blast_furnace' ||
                    block.name === 'smoker'
                )
            ) {
                return {
                    success: false,
                    result: `座標 (${furnacePosition.x}, ${furnacePosition.y}, ${furnacePosition.z}) にかまどがありません。`,
                };
            }

            const furnaceType =
                block.name === 'blast_furnace'
                    ? '溶鉱炉'
                    : block.name === 'smoker'
                        ? '燻製器'
                        : 'かまど';

            // インベントリから素材を探す
            const items = this.bot.inventory.items();
            const inputItems = items.filter(
                (item) =>
                    item.name.includes(inputItemName) ||
                    (item.displayName &&
                        item.displayName.toLowerCase().includes(inputItemName.toLowerCase()))
            );

            if (inputItems.length === 0) {
                return {
                    success: false,
                    result: `インベントリ内に "${inputItemName}" が見つかりませんでした。`,
                };
            }

            // インベントリから燃料を探す
            const fuelItems = items.filter(
                (item) =>
                    item.name.includes(fuelItemName) ||
                    (item.displayName &&
                        item.displayName
                            .toLowerCase()
                            .includes(fuelItemName.toLowerCase()))
            );

            if (fuelItems.length === 0) {
                return {
                    success: false,
                    result: `インベントリ内に "${fuelItemName}" が見つかりませんでした。`,
                };
            }

            // かまどを開く
            const furnace = await this.bot.openFurnace(block);

            // 素材を入力スロット（スロット0）に入れる
            let remainingInput = inputAmount;
            let totalInputDeposited = 0;

            for (const item of inputItems) {
                if (remainingInput <= 0) break;

                const depositAmount = Math.min(remainingInput, item.count);
                await furnace.putInput(item.type, item.metadata, depositAmount);

                remainingInput -= depositAmount;
                totalInputDeposited += depositAmount;
            }

            if (totalInputDeposited === 0) {
                await furnace.close();
                return {
                    success: false,
                    result: `"${inputItemName}" を${furnaceType}に入れることができませんでした。`,
                };
            }

            // 燃料を燃料スロット（スロット1）に入れる
            let remainingFuel = fuelAmount;
            let totalFuelDeposited = 0;

            for (const item of fuelItems) {
                if (remainingFuel <= 0) break;

                const depositAmount = Math.min(remainingFuel, item.count);
                await furnace.putFuel(item.type, item.metadata, depositAmount);

                remainingFuel -= depositAmount;
                totalFuelDeposited += depositAmount;
            }

            if (totalFuelDeposited === 0) {
                await furnace.close();
                return {
                    success: false,
                    result: `"${fuelItemName}" を${furnaceType}に入れることができませんでした。`,
                };
            }

            // 精錬完了を待つ場合
            if (waitForCompletion) {
                // 精錬が完了するまで待機（最大で入力アイテム数 × 10秒）
                const maxWaitTime = totalInputDeposited * 10 * 1000; // ミリ秒
                const startTime = Date.now();

                while (Date.now() - startTime < maxWaitTime) {
                    // 出力スロット（スロット2）をチェック
                    const outputItem = furnace.outputItem();
                    if (outputItem && outputItem.count >= totalInputDeposited) {
                        // 出力アイテムを取得
                        await furnace.takeOutput();
                        await furnace.close();

                        return {
                            success: true,
                            result: `${furnaceType}で "${inputItemName}" ${totalInputDeposited}個を精錬し、"${outputItem.name}" ${outputItem.count}個を取得しました。`,
                        };
                    }
                    // 1秒待機
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }

                // タイムアウト
                const outputItem = furnace.outputItem();
                if (outputItem && outputItem.count > 0) {
                    await furnace.takeOutput();
                    await furnace.close();
                    return {
                        success: true,
                        result: `${furnaceType}で一部精錬完了。"${outputItem.name}" ${outputItem.count}個を取得しました（要求: ${totalInputDeposited}個）。`,
                    };
                }

                await furnace.close();
                return {
                    success: false,
                    result: `${furnaceType}での精錬がタイムアウトしました。`,
                };
            }

            // 待たない場合はかまどを閉じて終了
            await furnace.close();

            return {
                success: true,
                result: `${furnaceType}に "${inputItemName}" ${totalInputDeposited}個と "${fuelItemName}" ${totalFuelDeposited}個を入れました。精錬を開始します。`,
            };
        } catch (error: any) {
            return {
                success: false,
                result: `かまどの使用中にエラーが発生しました: ${error.message}`,
            };
        }
    }
}

export default UseFurnace;

