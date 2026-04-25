import { motion } from "framer-motion";
import { Activity } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import RoiTracker from "@/pages/roi-tracker";
import Watchlist from "@/pages/watchlist";
import Insights from "@/pages/insights";

export default function PortfolioMonitor() {
  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Deal Flow · Portfolio Monitor</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <Activity className="w-8 h-8 text-primary" />
          Portfolio Monitor
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          ROI, watchlist alerts, and capability-level thresholds across portfolio companies in one view.
        </p>
      </motion.div>

      <Tabs defaultValue="roi" className="w-full">
        <TabsList>
          <TabsTrigger value="roi">ROI</TabsTrigger>
          <TabsTrigger value="watchlist">Watchlist</TabsTrigger>
          <TabsTrigger value="thresholds">Thresholds</TabsTrigger>
        </TabsList>
        <TabsContent value="roi" className="mt-4">
          <RoiTracker />
        </TabsContent>
        <TabsContent value="watchlist" className="mt-4">
          <Watchlist />
        </TabsContent>
        <TabsContent value="thresholds" className="mt-4">
          <Insights />
        </TabsContent>
      </Tabs>
    </div>
  );
}
