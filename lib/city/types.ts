export type Coord = [number, number];
export interface Feature {
  type?: string;
  geometry: { type: string; coordinates: any };
  properties: Record<string, any>;
}
export interface FeatureCollection {
  features: Feature[];
}
export interface TerrainData {
  [key: string]: any;
}
export interface SceneStats {
  buildings: number;
  trees: number;
  roads: number;
  fps: number;
  elevation: number;
  distance: number;
  speed?: number;
  heading?: number;
  lon?: number;
  lat?: number;
}
export interface Settings {
  hour: number;
  trees: boolean;
  buildings: boolean;
  labels: boolean;
  traffic: boolean;
  terrain: boolean;
  autoRotate: boolean;
  quality: 'high' | 'balanced';
  mode: 'orbit' | 'walk' | 'drive';
}
export interface Viewpoint {
  id: string;
  name: string;
  zh: string;
  coord: Coord;
  distance: number;
  azimuth: number;
  elevation: number;
  description: string;
  tag: string;
}
export const VIEWS: Viewpoint[] = [
  {
    id: 'overview',
    name: 'The peninsula',
    zh: '溫哥華全景',
    coord: [-123.13, 49.2885],
    distance: 8700,
    azimuth: 0.68,
    elevation: 0.83,
    tag: '全景',
    description: '從城市天際線到史丹利公園，沿著海岸探索整座半島。',
  },
  {
    id: 'downtown',
    name: 'Downtown',
    zh: '市中心',
    coord: [-123.1205, 49.2824],
    distance: 1800,
    azimuth: 0.55,
    elevation: 0.8,
    tag: '城市',
    description: '高樓與街廓沿著半島展開，西端住宅區逐漸升向市中心的高地。',
  },
  {
    id: 'stanley',
    name: 'Stanley Park',
    zh: '史丹利公園',
    coord: [-123.145, 49.302],
    distance: 2700,
    azimuth: 0.7,
    elevation: 0.86,
    tag: '自然',
    description: '森林、海堤與北側高地。公園的地勢以市政府等高線重建。',
  },
  {
    id: 'science',
    name: 'Science World',
    zh: '科學世界',
    coord: [-123.1032, 49.2734],
    distance: 610,
    azimuth: 0.8,
    elevation: 0.62,
    tag: '地標',
    description: '福溪東端的銀色測地穹頂，是 1986 年世界博覽會留給城市的地標。',
  },
  {
    id: 'canada',
    name: 'Canada Place',
    zh: '加拿大廣場',
    coord: [-123.1114, 49.2888],
    distance: 850,
    azimuth: -0.5,
    elevation: 0.67,
    tag: '海港',
    description:
      '五座白色帆頂面向 Burrard Inlet，港灣、遊輪碼頭與市中心在這裡相遇。',
  },
  {
    id: 'english',
    name: 'English Bay',
    zh: '英吉利灣',
    coord: [-123.1431, 49.286],
    distance: 1200,
    azimuth: 0.95,
    elevation: 0.63,
    tag: '海灘',
    description: '沙灘、海堤與西端住宅區，構成溫哥華面向夕陽的海岸。',
  },
  {
    id: 'falsecreek',
    name: 'False Creek',
    zh: '福溪',
    coord: [-123.124, 49.2728],
    distance: 2100,
    azimuth: 0.8,
    elevation: 0.76,
    tag: '水岸',
    description:
      'Burrard、Granville 與 Cambie 三座橋串起南北兩岸；小渡輪穿梭水面。',
  },
  {
    id: 'lions',
    name: 'Lions Gate',
    zh: '獅門大橋',
    coord: [-123.137, 49.3134],
    distance: 1500,
    azimuth: 1.8,
    elevation: 0.65,
    tag: '橋樑',
    description: '綠色懸索橋從公園的北端跨越 First Narrows，通向北岸山林。',
  },
];
export const DEFAULT_SETTINGS: Settings = {
  hour: 16,
  trees: true,
  buildings: true,
  labels: true,
  traffic: true,
  terrain: true,
  autoRotate: false,
  quality: 'high',
  mode: 'orbit',
};
