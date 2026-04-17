import { ThemeProvider as NextThemes } from "next-themes";
import { ReactNode } from "react";

export const ThemeProvider = ({ children }: { children: ReactNode }) => (
  <NextThemes attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
    {children}
  </NextThemes>
);
