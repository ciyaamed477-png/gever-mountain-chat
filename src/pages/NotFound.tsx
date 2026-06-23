import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
      <div className="text-6xl font-black tracking-wider">404</div>
      <p className="text-muted-foreground">Aradığın sayfa kayboldu.</p>
      <Link to="/">
        <Button>Ana sayfa</Button>
      </Link>
    </div>
  );
}
