import { CustomBot, InstantSkill } from '../types.js';

export class FaceToEntity extends InstantSkill {
  constructor(bot: CustomBot) {
    super(bot);
    this.skillName = 'face-to-entity';
    this.description = '視線を指定されたエンティティに向ける';
    this.params = [
      {
        name: 'entityName',
        type: 'string',
        description: 'エンティティの名前を指定します。',
        default: null,
      },
    ];
  }
  async run(entityName: string) {
    try {
      const entity = this.bot.utils.getNearestEntitiesByName(
        this.bot,
        entityName
      )[0];
      await this.bot.lookAt(entity.position);
      return {
        success: true,
        result: '視線を指定されたエンティティに向けました',
      };
    } catch (error: any) {
      return { success: false, result: `${error.message} in ${error.stack}` };
    }
  }
}

export default FaceToEntity;
