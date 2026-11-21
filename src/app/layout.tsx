import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "命题验证台 · Thesis Lab",
  description:
    "把投资命题拆解为可验证子问题，调用真实数据形成支持、反对与无法验证的证据链，产出可追溯结论与结论反转条件。本工具仅提供信息整理与证据验证，不构成投资建议。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[#f5f6f8] text-[#1f2329] antialiased">{children}</body>
    </html>
  );
}
