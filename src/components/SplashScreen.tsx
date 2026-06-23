import logo from "@/assets/gever-logo.png";

export default function SplashScreen() {
  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-4 bg-background">
      <img src={logo} alt="GEVER" className="h-24 w-24 animate-pulse" />
      <div className="text-2xl font-black tracking-[0.3em] text-foreground">GEVER</div>
    </div>
  );
}
