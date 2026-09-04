import type { Metadata } from 'next';
import { Geist,Geist_Mono } from 'next/font/google';
import './globals.css';
const geistSans=Geist({variable:'--font-geist-sans',subsets:['latin']});
const geistMono=Geist_Mono({variable:'--font-geist-mono',subsets:['latin']});
export const metadata:Metadata={title:'Vancouver · Living Atlas | 溫哥華立體地圖',description:'探索溫哥華 Downtown、Stanley Park 和 Science World。以真實地理資料重建的互動 3D 城市，包含地形、建築、海岸與公園。'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-Hant"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;}
