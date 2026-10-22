# 火箭遊戲：實際畫面與驗收

2026-10-22，分支 `codex/rocket-launch-game`。這些是執行中的 Three.js / WebGL 畫面，不是生成圖片。

完整規劃、來源、架構與測試結果見 [火箭遊戲規格](../ROCKET_LAUNCH_GAME.md)。

[城市破壞與完整小火箭任務的 18 項整合驗收](runtime-acceptance.md)另附實際數值、測試方法、畫面與可重跑腳本。

## 自然時間的大型火箭發射

從史丹利公園點選放置，實際建造、倒數和升空；這趟自然飛行到 100 km、Mission complete，再切第一視角與返回城市。截圖時間是功能開發中的一次驗收；最後手機控制與狀態欄配置見下方。

![史丹利公園升空](evidence/large-ascent-realtime.png)

## 手機預發射介面

390 × 844 viewport 的短卡保留箭體與搭建架視野，完整設定由 options 展開；這是桌面 Chrome 的響應式驗收，沒有宣稱實機手機效能。

![手機預發射](evidence/mobile-ready.png)

## 手動第一視角與雙指操作

姿態 HUD 顯示有方向的 pitch、roll 和爬升速度。此張用已知姿態建立 UI fixture，專門確認顯示與佈局；完整上升物理另有自然時間與加速整合驗收。

原生觸控事件驗證左側搖桿保持輸入時，第二指可獨立調整右側推力；隱藏 HUD 仍保留核心操控與中止。

![手機手動姿態儀](evidence/mobile-manual.png)
