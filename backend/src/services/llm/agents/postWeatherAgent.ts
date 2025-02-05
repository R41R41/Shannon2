import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { PromptType } from '@shannon/common';
import axios from 'axios';
import { addDays, format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import dotenv from 'dotenv';
import { loadPrompt } from '../config/prompts.js';
import { TaskGraph } from '../graph/taskGraph.js';

dotenv.config();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set');
}
const jst = 'Asia/Tokyo';

interface Forecast {
  date: string;
  forecasts: string;
}

export class PostWeatherAgent {
  private model: ChatOpenAI;
  private cities: [string, string][];
  private displayCities: string[];
  private searchCities: string[];
  private url: string;
  private systemPrompts: Map<PromptType, string>;
  private cityForecasts: any[] | null = null;
  private forecasts: Forecast[] = [];
  private forecastObservations: string[] = [
    'city',
    'temperature',
    'weather',
    'chanceOfRain',
  ];
  private taskGraph: TaskGraph;

  constructor(
    systemPrompts: Map<PromptType, string>,
    cities: string[] = ['仙台', '東京', '名古屋', '大阪', '福岡']
  ) {
    this.model = new ChatOpenAI({
      modelName: 'gpt-4o',
      temperature: 0.8,
      apiKey: OPENAI_API_KEY,
    });
    this.taskGraph = new TaskGraph();
    this.cities = [
      ['稚内', '011000'],
      ['根室', '014010'],
      ['札幌', '016010'],
      ['函館', '017010'],
      ['青森', '020010'],
      ['盛岡', '030010'],
      ['仙台', '040010'],
      ['秋田', '050010'],
      ['山形', '060010'],
      ['福島', '070010'],
      ['水戸', '080010'],
      ['宇都宮', '090010'],
      ['前橋', '100010'],
      ['熊谷', '110020'],
      ['銚子', '120020'],
      ['東京', '130010'],
      ['八丈島', '130030'],
      ['横浜', '140010'],
      ['新潟', '150010'],
      ['富山', '160010'],
      ['金沢', '170010'],
      ['福井', '180010'],
      ['甲府', '190010'],
      ['長野', '200010'],
      ['岐阜', '210010'],
      ['浜松', '220040'],
      ['名古屋', '230010'],
      ['津', '240010'],
      ['大津', '250010'],
      ['京都', '260010'],
      ['大阪', '270000'],
      ['神戸', '280010'],
      ['奈良', '290010'],
      ['和歌山', '300010'],
      ['鳥取', '310010'],
      ['松江', '320010'],
      ['岡山', '330010'],
      ['広島', '340010'],
      ['山口', '350020'],
      ['徳島', '360010'],
      ['高松', '370000'],
      ['松山', '380010'],
      ['高知', '390010'],
      ['福岡', '400010'],
      ['佐賀', '410010'],
      ['長崎', '420010'],
      ['熊本', '430010'],
      ['大分', '440010'],
      ['宮崎', '450010'],
      ['鹿児島', '460010'],
      ['那覇', '471010'],
    ];
    this.displayCities = cities;
    this.searchCities = [
      '函館',
      '仙台',
      '水戸',
      '熊谷',
      '東京',
      '名古屋',
      '金沢',
      '新潟',
      '浜松',
      '大阪',
      '広島',
      '高知',
      '福岡',
      '那覇',
    ];
    this.url = 'https://weather.tsukumijima.net/api/forecast?city=';
    this.systemPrompts = systemPrompts;
  }

  public static async create(): Promise<PostWeatherAgent> {
    const promptsName: PromptType[] = [
      'forecast',
      'weather_to_emoji',
      'forecast_for_toyama_server',
    ];
    const systemPrompts = new Map();
    for (const name of promptsName) {
      systemPrompts.set(name, await loadPrompt(name));
    }
    return new PostWeatherAgent(systemPrompts);
  }

  private async getUrl(city: string): Promise<any> {
    const response = await axios.get(`${this.url}${city}`);
    return response.data;
  }

  private async getTelop(forecastData: any): Promise<string> {
    return forecastData['telop'];
  }

  private async getEmoji(telop: string, chanceOfRain: string): Promise<string> {
    const systemContent = this.systemPrompts.get('weather_to_emoji');
    if (!systemContent) {
      throw new Error('systemPrompt is not set');
    }
    const humanContent = `weather:${telop}\nchanceOfRain:${chanceOfRain}`;
    const result = await this.model.invoke([
      new SystemMessage(systemContent),
      new HumanMessage(humanContent),
    ]);
    return result.content.toString();
  }

  private getTemperature(forecastData: any): string {
    const temperatureData = forecastData['temperature'];
    const min = temperatureData['min']['celsius'];
    const max = temperatureData['max']['celsius'];
    return `${min}-${max}℃`;
  }

  private getChanceOfRain(forecastData: any): string {
    const chanceOfRainData = forecastData['chanceOfRain'];
    console.log('chanceOfRainData:', chanceOfRainData);
    const t00_06 = chanceOfRainData['T00_06'] || '0%';
    const t06_12 = chanceOfRainData['T06_12'] || '0%';
    const t12_18 = chanceOfRainData['T12_18'] || '0%';
    const t18_24 = chanceOfRainData['T18_24'] || '0%';
    const result = `${t00_06}${t06_12}${t12_18}${t18_24}`;
    console.log('chanceOfRain result:', result);
    return result;
  }

  private getWeather(forecastData: any): string {
    const weatherData = forecastData['detail']['weather'];
    return weatherData.replace('\u3000', '');
  }

  private async setCityForecasts(): Promise<void> {
    const forecasts: any[] = [];
    for (const city of this.cities) {
      if (this.searchCities.includes(city[0])) {
        const data = await this.getUrl(city[1]);
        const forecastData = data['forecasts'][1];
        const cityName = city[0];
        const telop = await this.getTelop(forecastData);
        const temperature = this.getTemperature(forecastData);
        const chanceOfRain = this.getChanceOfRain(forecastData);
        const weather = this.getWeather(forecastData);
        const forecast = {
          city: cityName,
          telop,
          temperature,
          chanceOfRain,
          weather,
        };
        forecasts.push(forecast);
      }
    }
    this.cityForecasts = forecasts;
  }

  private getTomorrowDate(): string {
    const now = toZonedTime(new Date(), jst);
    const tomorrow = addDays(now, 1);
    const date = format(tomorrow, 'yyyy年MM月dd日');
    const weekdayInt = tomorrow.getDay();
    const weekdayStr = ['月', '火', '水', '木', '金', '土', '日'];
    return `${date}(${weekdayStr[weekdayInt]})`;
  }

  private async getMaxChanceOfRain(chanceOfRain: string): Promise<string> {
    console.log('Input chanceOfRain:', chanceOfRain);
    const chanceOfRainList = chanceOfRain
      .split('%')
      .map(Number)
      .filter((n) => !isNaN(n));
    console.log('chanceOfRainList:', chanceOfRainList);

    if (chanceOfRainList.length === 0) {
      return '0%';
    }

    const maxChanceOfRain = Math.max(...chanceOfRainList);
    return `${maxChanceOfRain}%`;
  }

  private async getData(): Promise<string> {
    const cityForecasts = this.cityForecasts;
    if (!cityForecasts) {
      throw new Error('cityForecasts is not set');
    }
    const date = this.getTomorrowDate();
    let dataSentence = `【明日${date}の天気】\n`;
    for (const forecast of cityForecasts) {
      const city = forecast['city'];
      if (this.displayCities.includes(city)) {
        const padding = city.length <= 2 ? '　'.repeat(3 - city.length) : '';
        const cityName = city + padding;
        const emoji = await this.getEmoji(
          forecast['telop'],
          forecast['chanceOfRain']
        );
        const temperature = forecast['temperature'];
        const chanceOfRain = await this.getMaxChanceOfRain(
          forecast['chanceOfRain']
        );
        const text = `${cityName}：${emoji}, ${temperature}, ${chanceOfRain}\n`;
        dataSentence += text;
      }
    }
    return dataSentence;
  }

  private async getComment(): Promise<string> {
    const cityForecasts = this.cityForecasts;
    if (!cityForecasts) {
      throw new Error('cityForecasts is not set');
    }
    const date = this.getTomorrowDate();
    const systemContent = this.systemPrompts.get('forecast');
    if (!systemContent) {
      throw new Error('systemPrompt is not set');
    }
    const lastForecast = this.forecasts[this.forecasts.length - 1];
    const humanContent =
      `tomorrow's date:${date}\n` +
      cityForecasts
        .map((forecast: any) => {
          return this.forecastObservations
            .map((observation) => {
              return `${observation}:${forecast[observation]}`;
            })
            .join('\n');
        })
        .join('\n') +
      `${lastForecast ? `\nToday's weather:\n${lastForecast.forecasts}` : ''}`;
    const result = await this.model.invoke([
      new SystemMessage(systemContent),
      new HumanMessage(humanContent),
    ]);
    return result.content.toString();
  }

  private async setForecasts(date: string, forecast: string): Promise<void> {
    this.forecasts.push({
      date: date,
      forecasts: forecast,
    });
  }

  public async createPost(): Promise<string> {
    await this.setCityForecasts();
    const dataSentence = await this.getData();
    const commentSentence = await this.getComment();
    const date = this.getTomorrowDate();
    this.setForecasts(date, dataSentence + '\n\n' + commentSentence);
    return `${dataSentence}\n\n${commentSentence}`;
  }

  public async createPostForToyama(): Promise<string> {
    const infoMessage = JSON.stringify({
      forecast: this.forecasts[this.forecasts.length - 1],
    });
    const prompt = this.systemPrompts.get('forecast_for_toyama_server');
    if (!prompt) {
      throw new Error('forecast_for_toyama_server prompt not found');
    }
    const result = await this.taskGraph.invoke({
      memoryZone: 'discord:toyama_server',
      systemPrompt: prompt,
      infoMessage: infoMessage,
      messages: [],
      taskTree: {
        goal: '',
        plan: '',
        status: 'pending',
        subTasks: [],
      },
      conversationHistory: {
        messages: [],
      },
      decision: '',
    });
    const postForToyama =
      result.messages[result.messages.length - 1].content.toString();
    return `${postForToyama}`;
  }
}
