import "@fontsource-variable/manrope";
import "./globals.css";

export const metadata = {
  title: "Employees | People Analytics",
  description: "Browse the employee roster from PA Task.xlsx.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
