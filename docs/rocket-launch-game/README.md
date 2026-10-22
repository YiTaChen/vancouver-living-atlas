# 火箭遊戲：實際畫面與驗收

2026-10-22，分支 `codex/rocket-launch-game`。以下是執行中的 Three.js / WebGL 畫面，不是生成圖片。

## 新版：級間分離、上面級與太空觀察

[級間分離](evidence/integrated-stage-separation.png) · [上面級進入太空](evidence/integrated-upper-stage-space.png) · [太陽觀察](evidence/integrated-sun-observation.png) · [月球觀察](evidence/integrated-moon-observation.png)

這組新版畫面來自實際生產控制器的加速步進驗收：第一級消耗燃料、助推器分離、上面級點火後繼續升空，直到任務完成；沒有指定成功狀態或把高度直接設為 100 km。大小火箭分別在 **65.633／65.633 模擬飛行秒**越過 100 km，這是從離地開始的飛行時間，不含搭建與倒數，也不是測試程式的牆鐘時間。

![新版大型火箭級間分離](evidence/integrated-stage-separation.png)

![上面級進入太空與非遮擋觀察卡](evidence/integrated-upper-stage-space.png)

完成後直接顯示小型太空觀察卡，可選 Earth／Sun／Moon／Rocket，並切換第一／第三視角或回城市；任務詳細結果預設收折。以下日月畫面由驗收程式點擊實際 Sun、Moon 按鈕取得，兩個焦點均通過置中檢查。

![由實際 Sun 按鈕找到太陽](evidence/integrated-sun-observation.png)

![由實際 Moon 按鈕找到月球](evidence/integrated-moon-observation.png)

[目前 21／21 項整合驗收](runtime-acceptance.md)附完整方法、數值與可重跑腳本；[原始報告](runtime-report.json)保留各階段狀態、事件與檢查結果。這次城市發射記錄到 16 個受損建築部件、15 棵起火樹木與 67 個碎片；實際小屋頂上的大型火箭造成支撐垮塌、1 個建築部件受損與 5 個碎片。

完整規劃、來源與架構見 [火箭遊戲規格](../ROCKET_LAUNCH_GAME.md)。

## 新版自然時間飛行與小視窗

在 IAB 一般圖形模式從史丹利公園實際點選地面、搭建、倒數，自然飛經第一級分離、第二級點火到任務完成，沒有透過測試程式設定高度或成功狀態。以下為該趟飛行中的第二級，以及完成後持續滑行的實際畫面；觀察時高度會繼續增加，並非宣稱入軌。

615 × 669 小視窗的完成卡改置下方安全區，讓鼻尖與中央箭身完整可見；390 px 手機尺寸同樣置下方，橫向與寬桌面維持側邊。展開結果會在卡內捲動，回城操作持續可用。

![自然時間第二級推進](evidence/natural-second-stage.png)

![自然任務完成後的小視窗安全區](evidence/natural-space-safe-panel.png)

## 首輪自然時間的大型火箭發射（歷史畫面）

這張保留第一輪開發時從史丹利公園點選放置、搭建、倒數和自然升空的畫面；該趟抵達 100 km、完成任務，再切第一視角與返回城市。它早於新版兩級分離、加快升空節奏與太空焦點介面，不能用來代表目前約 65.6 秒的模擬飛行時間。

![首輪史丹利公園自然時間升空](evidence/large-ascent-realtime.png)

## 手機預發射介面實測

390 × 844 viewport 的短卡保留箭體與搭建架視野，完整設定由 options 展開；這是桌面 Chrome 的響應式 UI 驗收，沒有宣稱實機手機效能。

![手機預發射](evidence/mobile-ready.png)

## 手動第一視角與雙指操作：UI fixture

姿態 HUD 顯示有方向的 pitch、roll 和爬升速度。此張用已知姿態與高度建立 **UI fixture**，專門確認顯示與佈局，不作完整升空或實機效能的證據；目前兩級上升物理與手動切自動任務另由上方 21 項整合驗收覆蓋。

原生觸控事件也驗證了左側搖桿保持輸入時，第二指可獨立調整右側推力；隱藏 HUD 仍保留核心操控與中止。這是控制綁定實測，與 fixture 的預設飛行姿態分開解讀。

![手機手動姿態儀 UI fixture](evidence/mobile-manual.png)
