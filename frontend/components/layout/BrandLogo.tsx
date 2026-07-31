"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { useForwardTest } from "@/lib/store";

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  const { dark } = useForwardTest();
  const src = dark ? "/brand/arwl-logo-white.png" : "/brand/arwl-logo.png";
  return (
    <Link aria-label="Anand Rathi Wealth home" className="brand-logo-link shrink-0" href="/">
      <motion.span whileHover={{ scale: 1.04 }} transition={{ type: "spring", stiffness: 380, damping: 20 }}>
        <Image
          alt="Anand Rathi Wealth"
          className={compact ? "h-8 w-auto" : "h-10 w-auto md:h-11"}
          height={290}
          priority
          src={src}
          width={1280}
        />
      </motion.span>
    </Link>
  );
}
