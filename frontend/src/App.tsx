import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import Index from "./pages/Index.tsx";
import Intake from "./pages/Intake.tsx";
import Summary from "./pages/Summary.tsx";
import Simulate from "./pages/Simulate.tsx";
import Exclusions from "./pages/Exclusions.tsx";
import QA from "./pages/QA.tsx";
import NotFound from "./pages/NotFound.tsx";

import Explainer from "./pages/Explainer.tsx";

const queryClient = new QueryClient();

const App = () => (
  <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/intake" element={<Intake />} />
            <Route path="/summary" element={<Summary />} />
            <Route path="/simulate" element={<Simulate />} />
            <Route path="/exclusions" element={<Exclusions />} />
            <Route path="/qa" element={<QA />} />
            <Route path="/explainer" element={<Explainer />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
