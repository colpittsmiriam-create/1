import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "建材智途 AI · 场内物流工作台",
  description: "施工现场建材搬运路径规划、堆场比选与物料调度，支持登录和云端项目保存。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
