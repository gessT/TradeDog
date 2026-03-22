import "../styles/globals.css";

export const metadata = {
  title: "Trading Monitor",
  description: "Datadog-style trading dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
