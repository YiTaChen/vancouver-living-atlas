/** Original walking observations, anchored to the current municipal road model.
 * These are virtual exploration trails, not surveyed real-world walking advice.
 * Source corridors were exercised by upgrade-endurance-qa; runtime placement
 * still checks the current ground/collision model and never bypasses it. */
export type DiscoveryPoint = readonly [number, number];
export type DiscoveryCopy = {
  en: string;
  'zh-Hant': string;
  'zh-Hans': string;
};
export interface DiscoveryStop {
  id: string;
  position: DiscoveryPoint;
  title: DiscoveryCopy;
  note: DiscoveryCopy;
  source?: string;
}
export interface DiscoveryRoute {
  id: string;
  title: DiscoveryCopy;
  subtitle: DiscoveryCopy;
  start: DiscoveryPoint;
  stops: readonly DiscoveryStop[];
  source: string;
  accent: string;
}
const copy = (
  en: string,
  traditional: string,
  simplified: string,
): DiscoveryCopy => ({ en, 'zh-Hant': traditional, 'zh-Hans': simplified });
const waterStart: DiscoveryPoint = [1704.4201986244195, 273.28826168075756];
const waterEnd: DiscoveryPoint = [1415.0585986383298, 192.48575031961587];
const robsonStart: DiscoveryPoint = [415.67587947125975, 339.6261879997863];
const robsonEnd: DiscoveryPoint = [-539.8137202898291, -609.6551120001666];
function along(
  a: DiscoveryPoint,
  b: DiscoveryPoint,
  meters: number,
): DiscoveryPoint {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [
    a[0] + ((b[0] - a[0]) * meters) / length,
    a[1] + ((b[1] - a[1]) * meters) / length,
  ];
}
export const DISCOVERY_ROUTES: readonly DiscoveryRoute[] = [
  {
    id: 'gastown',
    title: copy(
      'Gastown · Reading the street',
      '煤氣鎮 · 讀懂街道',
      '煤气镇 · 读懂街道',
    ),
    subtitle: copy(
      'Find three layers of a heritage streetscape.',
      '沿著 Water Street，收集老街的三種細節。',
      '沿着 Water Street，收集老街的三种细节。',
    ),
    start: waterStart,
    accent: '#efc3a0',
    source:
      'WATER ST RoadGraph edges 2973,3794; source IDs 29:0,846:0. First 250 m of the previously audited 300.432 m chord.',
    stops: [
      {
        id: 'brick',
        source: 'https://guidelines.vancouver.ca/guidelines-ha-2-gastown.pdf',
        position: along(waterStart, waterEnd, 65),
        title: copy('The rhythm of the facade', '立面的節奏', '立面的节奏'),
        note: copy(
          'Many Water Street buildings began as warehouses and were later adapted for shops. Look above the storefronts: broad masonry walls and repeated window bays still tell the story of that working waterfront.',
          'Water Street 的許多建築原本是倉庫，後來才改作商店。從店面向上看：寬闊的磚石牆與重複的窗格，仍訴說著這片海濱過往的工作日常。',
          'Water Street 的许多建筑原本是仓库，后来才改作商店。从店面向上看：宽阔的砖石墙与重复的窗格，仍诉说着这片海滨过往的工作日常。',
        ),
      },
      {
        id: 'cornice',
        source:
          'https://vancouver.ca/files/cov/gastown-heritage-management-plan-2001.pdf',
        position: along(waterStart, waterEnd, 155),
        title: copy(
          'Where the wall meets the sky',
          '牆面與天空交會處',
          '墙面与天空交会处',
        ),
        note: copy(
          'Water Street’s varied building heights and projecting cornices give its roofline a distinctive sawtooth rhythm. Find one cornice casting a shadow, then follow the roof edges along the next few buildings.',
          'Water Street 高低不同的建築與突出簷口，組成獨特的鋸齒狀屋頂輪廓。找一處投下陰影的簷口，再沿著附近幾棟建築的屋頂慢慢看過去。',
          'Water Street 高低不同的建筑与突出檐口，组成独特的锯齿状屋顶轮廓。找一处投下阴影的檐口，再沿着附近几栋建筑的屋顶慢慢看过去。',
        ),
      },
      {
        id: 'perspective',
        position: along(waterStart, waterEnd, 250),
        title: copy(
          'Looking back along Water Street',
          '回望 Water Street',
          '回望 Water Street',
        ),
        note: copy(
          'Turn back toward the route you walked. Shopfronts, trees, the road edge and the changing roofline now form one continuous scene. Notice how much you can recognise now that you have walked the street yourself.',
          '轉身回望剛走過的路。店面、樹木、道路邊緣與高低變化的屋頂，連成完整的街景；走過一次之後，看看你現在能認出多少剛才遇見的細節。',
          '转身回望刚走过的路。店面、树木、道路边缘与高低变化的屋顶，连成完整的街景；走过一次之后，看看你现在能认出多少刚才遇见的细节。',
        ),
      },
    ],
  },
  {
    id: 'robson',
    title: copy(
      'Robson · City in layers',
      'Robson 街 · 城市的層次',
      'Robson 街 · 城市的层次',
    ),
    subtitle: copy(
      'Walk from Burrard toward the West End.',
      '從 Burrard 路口，向西端住宅區前進。',
      '从 Burrard 路口，向西端住宅区前进。',
    ),
    start: along(robsonStart, robsonEnd, 40),
    accent: '#b4d9df',
    source:
      'First portion of source Robson corridor, after BURRARD ST crossing, along RoadGraph edges 3953,3798,588,2999,3775,2753,340,3095,3022,858,665.',
    stops: [
      {
        id: 'streetwall',
        source: 'https://vancouver.ca/news-calendar/west-end.aspx',
        position: along(robsonStart, robsonEnd, 125),
        title: copy('The human-height city', '人的尺度', '人的尺度'),
        note: copy(
          'The West End’s first apartment buildings grew along the Robson streetcar line. As you walk, look for the change between busy ground-floor shopfronts and the quieter residential floors above.',
          '西端最早的公寓沿著 Robson 電車路線出現。散步時，留意熱鬧的一樓店面，與上方較安靜的住宅樓層之間的變化。',
          '西端最早的公寓沿着 Robson 电车路线出现。散步时，留意热闹的一楼店面，与上方较安静的住宅楼层之间的变化。',
        ),
      },
      {
        id: 'glass',
        position: along(robsonStart, robsonEnd, 275),
        title: copy('Glass and solid walls', '玻璃與實牆', '玻璃与实墙'),
        note: copy(
          'Compare reflective glass with opaque masonry. Glass carries the colour of the sky; solid walls reveal their texture through light and shade. The contrast helps separate the downtown skyline into layers.',
          '比較反光玻璃與不透明的磚石牆。玻璃帶著天空的色彩，實牆透過明暗呈現紋理；兩者的差異讓市中心天際線更有層次。',
          '比较反光玻璃与不透明的砖石墙。玻璃带着天空的色彩，实墙透过明暗呈现纹理；两者的差异让市中心天际线更有层次。',
        ),
      },
      {
        id: 'distance',
        position: along(robsonStart, robsonEnd, 400),
        title: copy(
          'Near, middle, far',
          '前景、中景、遠景',
          '前景、中景、远景',
        ),
        note: copy(
          'Pause and look along Robson. Nearby trees and shopfronts frame the middle-distance buildings, while taller silhouettes sit behind them. Try framing a view with a tree on one side and a tower in the distance.',
          '停下來沿 Robson 街望去。近處樹木與店面框住中距離建築，更高的輪廓退到後方；試著找一個角度，讓樹木在一側、高樓在遠方，一起留在視線裡。',
          '停下来沿 Robson 街望去。近处树木与店面框住中距离建筑，更高的轮廓退到后方；试着找一个角度，让树木在一侧、高楼在远方，一起留在视线里。',
        ),
      },
    ],
  },
  {
    id: 'west-end',
    title: copy(
      'West End · A living neighbourhood',
      '西端 · 生活中的街區',
      '西端 · 生活中的街区',
    ),
    subtitle: copy(
      'Follow Robson from Cardero toward Denman.',
      '沿 Robson 街，從 Cardero 走向 Denman。',
      '沿 Robson 街，从 Cardero 走向 Denman。',
    ),
    start: along(robsonStart, robsonEnd, 1035),
    accent: '#c5dea7',
    source:
      'West End portion of audited Robson corridor, after CARDERO ST through BIDWELL toward DENMAN, ending before the far corridor endpoint.',
    stops: [
      {
        id: 'canopy',
        position: along(robsonStart, robsonEnd, 1100),
        title: copy('A green ceiling', '綠色的天花板', '绿色的天花板'),
        note: copy(
          'Watch how tree trunks, gaps in the leaves and patches of shade change the street. Look through a gap in the canopy for a glimpse of the homes beyond.',
          '留意樹幹、葉片間隙與斑駁陰影如何改變街景。從樹冠的空隙望過去，尋找藏在綠蔭後方的住宅。',
          '留意树干、叶片间隙与斑驳阴影如何改变街景。从树冠的空隙望过去，寻找藏在绿荫后方的住宅。',
        ),
      },
      {
        id: 'homes',
        position: along(robsonStart, robsonEnd, 1200),
        title: copy('A change in scale', '尺度的轉變', '尺度的转变'),
        note: copy(
          'Look between the larger buildings for lower rooflines and smaller windows. Compare the proportions of a small home with the larger apartments around it: a neighbourhood holds many different ways of living.',
          '在大樓之間尋找較低的屋頂與小窗戶。比較小住宅與周圍公寓的比例：同一個街區，也容納著不同的生活方式。',
          '在大楼之间寻找较低的屋顶与小窗户。比较小住宅与周围公寓的比例：同一个街区，也容纳着不同的生活方式。',
        ),
      },
      {
        id: 'neighbourhood',
        source:
          'https://vancouver.ca/files/cov/west-end-community-plan-2013-nov.pdf',
        position: along(robsonStart, robsonEnd, 1310),
        title: copy(
          'The neighbourhood together',
          '街區的整體感',
          '街区的整体感',
        ),
        note: copy(
          'You are approaching Denman Village, a neighbourhood centre of low-rise shops and community amenities serving the surrounding homes. Turn back and compare this everyday streetscape with the warehouse fronts of Gastown.',
          '你正接近 Denman Village。這裡的低層商店與社區設施服務周邊住宅，是居民的生活中心。回頭看看，這片日常街景和煤氣鎮的倉庫立面有什麼不同？',
          '你正接近 Denman Village。这里的低层商店与社区设施服务周边住宅，是居民的生活中心。回头看看，这片日常街景和煤气镇的仓库立面有什么不同？',
        ),
      },
    ],
  },
];
export function discoveryCopy(text: DiscoveryCopy, locale: string) {
  return text[locale === 'zh-Hant' || locale === 'zh-Hans' ? locale : 'en'];
}
export function discoveryRoute(id: unknown) {
  return DISCOVERY_ROUTES.find((route) => route.id === id);
}
export function discoveryLegStart(
  route: DiscoveryRoute,
  next: number,
): DiscoveryPoint {
  return next > 0
    ? route.stops[Math.min(next, route.stops.length) - 1].position
    : route.start;
}
export function discoveryRouteLength(route: DiscoveryRoute) {
  return route.stops.reduce((sum, stop, index) => {
    const previous = discoveryLegStart(route, index);
    return (
      sum +
      Math.hypot(stop.position[0] - previous[0], stop.position[1] - previous[1])
    );
  }, 0);
}
