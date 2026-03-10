import minecraftData from 'minecraft-data';
import { getSmeltingSource } from './smeltingRecipes.js';

interface DependencyNode {
    item: string;
    quantity: number;
    children: DependencyNode[];
    method: 'craft' | 'smelt' | 'raw';
    requiresCraftingTable?: boolean;
    requiresFurnace?: boolean;
}

/**
 * Minecraft のクラフト／精錬レシピを再帰的に解決し、
 * ツリー形式の依存チェーンを構築する。
 *
 * ForwardModel や FCA のプロンプト注入で利用される。
 */
export class RecipeDependencyResolver {
    private mcData: ReturnType<typeof minecraftData>;
    private version: string;

    private static instance: RecipeDependencyResolver | null = null;

    private constructor(version: string) {
        this.version = version;
        this.mcData = minecraftData(version);
    }

    static getInstance(version: string): RecipeDependencyResolver {
        if (!RecipeDependencyResolver.instance || RecipeDependencyResolver.instance.version !== version) {
            RecipeDependencyResolver.instance = new RecipeDependencyResolver(version);
        }
        return RecipeDependencyResolver.instance;
    }

    /**
     * アイテム名から依存ツリーを再帰的に構築する。
     * maxDepth で無限再帰を防止。
     */
    resolve(itemName: string, quantity = 1, maxDepth = 5): DependencyNode {
        return this.resolveInternal(itemName, quantity, maxDepth, new Set());
    }

    private resolveInternal(
        itemName: string,
        quantity: number,
        depth: number,
        visited: Set<string>,
    ): DependencyNode {
        if (depth <= 0 || visited.has(itemName)) {
            return { item: itemName, quantity, children: [], method: 'raw' };
        }

        visited.add(itemName);

        const craftNode = this.tryResolveCraft(itemName, quantity, depth, visited);
        if (craftNode) {
            visited.delete(itemName);
            return craftNode;
        }

        const smeltNode = this.tryResolveSmelt(itemName, quantity, depth, visited);
        if (smeltNode) {
            visited.delete(itemName);
            return smeltNode;
        }

        visited.delete(itemName);
        return { item: itemName, quantity, children: [], method: 'raw' };
    }

    private tryResolveCraft(
        itemName: string,
        quantity: number,
        depth: number,
        visited: Set<string>,
    ): DependencyNode | null {
        const item = this.mcData.itemsByName[itemName];
        if (!item) return null;

        const recipes = this.mcData.recipes[item.id];
        if (!recipes || recipes.length === 0) return null;

        const recipe = recipes[0] as any;
        const resultCount = recipe.result?.count ?? 1;
        const craftCount = Math.ceil(quantity / resultCount);

        const ingredients = this.extractIngredients(recipe);
        if (ingredients.length === 0) return null;

        const requiresCraftingTable = this.requiresCraftingTable(recipe);

        const children: DependencyNode[] = ingredients.map(({ name, count }) =>
            this.resolveInternal(name, count * craftCount, depth - 1, visited),
        );

        return {
            item: itemName,
            quantity,
            children,
            method: 'craft',
            requiresCraftingTable,
        };
    }

    private tryResolveSmelt(
        itemName: string,
        quantity: number,
        depth: number,
        visited: Set<string>,
    ): DependencyNode | null {
        const smelting = getSmeltingSource(itemName);
        if (!smelting) return null;

        const inputNode = this.resolveInternal(smelting.input, quantity, depth - 1, visited);
        return {
            item: itemName,
            quantity,
            children: [inputNode],
            method: 'smelt',
            requiresFurnace: true,
        };
    }

    private extractIngredients(recipe: any): Array<{ name: string; count: number }> {
        const countMap = new Map<number, number>();

        if (recipe.inShape) {
            for (const row of recipe.inShape) {
                for (const cell of row) {
                    const id = Array.isArray(cell) ? cell[0] : cell;
                    if (id == null || id === -1) continue;
                    countMap.set(id, (countMap.get(id) || 0) + 1);
                }
            }
        } else if (recipe.ingredients) {
            for (const ing of recipe.ingredients) {
                const id = Array.isArray(ing) ? ing[0] : ing;
                if (id == null || id === -1) continue;
                countMap.set(id, (countMap.get(id) || 0) + 1);
            }
        }

        const result: Array<{ name: string; count: number }> = [];
        for (const [id, count] of countMap) {
            const itemInfo = this.mcData.items[id];
            if (itemInfo) {
                result.push({ name: itemInfo.name, count });
            }
        }
        return result;
    }

    /**
     * レシピが3x3グリッドを使用する（= crafting_table が必要）か判定。
     * inShape が 3行 or いずれかの行が3列なら crafting_table 必須。
     */
    private requiresCraftingTable(recipe: any): boolean {
        if (recipe.inShape) {
            if (recipe.inShape.length > 2) return true;
            for (const row of recipe.inShape) {
                if (row.length > 2) return true;
            }
        }
        if (recipe.ingredients && recipe.ingredients.length > 4) return true;
        return false;
    }

    /**
     * 依存ツリーを LLM プロンプト用のテキストにフォーマットする。
     */
    formatForPrompt(node: DependencyNode, indent = 0): string {
        const prefix = '  '.repeat(indent);
        const lines: string[] = [];

        let label = `${prefix}${node.item} x${node.quantity}`;

        if (node.method === 'craft') {
            label += node.requiresCraftingTable ? ' [クラフト: 作業台必要]' : ' [クラフト: 手元可]';
        } else if (node.method === 'smelt') {
            label += ' [精錬: かまど必要]';
        } else if (indent > 0) {
            label += ' [素材]';
        }

        lines.push(label);

        for (const child of node.children) {
            lines.push(this.formatForPrompt(child, indent + 1));
        }

        return lines.join('\n');
    }

    /**
     * 複数のアイテムの依存チェーンを一括でフォーマットし、
     * FCA システムプロンプトに注入するテキストを構築する。
     */
    buildDependencyPrompt(items: string[]): string | null {
        const sections: string[] = [];

        for (const item of items) {
            try {
                const tree = this.resolve(item);
                if (tree.children.length > 0) {
                    sections.push(this.formatForPrompt(tree));
                }
            } catch {
                // unknown item — skip
            }
        }

        if (sections.length === 0) return null;

        return `\n\n## クラフト依存チェーン（参考）\n以下はターゲットアイテムの完全な依存ツリーです。素材の確保から順に実行してください。\n\n${sections.join('\n\n')}`;
    }
}
