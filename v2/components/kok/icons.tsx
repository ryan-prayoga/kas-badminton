"use client";

import { Icon, type IconifyIcon } from "@iconify/react";
import racket from "@iconify-icons/mdi/tennis-racket";
import back from "@iconify-icons/mdi/arrow-left";
import shuttle from "@iconify-icons/game-icons/shuttlecock";
import cash from "@iconify-icons/mdi/cash-multiple";
import calendar from "@iconify-icons/mdi/calendar-blank-outline";
import chevronDown from "@iconify-icons/mdi/chevron-down";
import checkCircle from "@iconify-icons/mdi/check-circle";
import check from "@iconify-icons/mdi/check";
import clock from "@iconify-icons/mdi/clock-outline";
import refresh from "@iconify-icons/mdi/refresh";
import shield from "@iconify-icons/mdi/shield-account-outline";
import share from "@iconify-icons/mdi/share-variant-outline";
import wallet from "@iconify-icons/mdi/wallet-outline";
import history from "@iconify-icons/mdi/history";
import chart from "@iconify-icons/mdi/chart-box-outline";
import trophy from "@iconify-icons/mdi/trophy-outline";
import pkg from "@iconify-icons/mdi/package-variant";
import users from "@iconify-icons/mdi/account-multiple-outline";
import pencil from "@iconify-icons/mdi/pencil-outline";
import plus from "@iconify-icons/mdi/plus";
import minus from "@iconify-icons/mdi/minus";
import alert from "@iconify-icons/mdi/alert-circle-outline";
import trash from "@iconify-icons/mdi/trash-can-outline";
import lock from "@iconify-icons/mdi/lock-outline";
import key from "@iconify-icons/mdi/key-variant";
import close from "@iconify-icons/mdi/close";
import cart from "@iconify-icons/mdi/cart-outline";
import save from "@iconify-icons/mdi/content-save-outline";
import logout from "@iconify-icons/mdi/logout";
import cog from "@iconify-icons/mdi/cog-outline";
import accountPlus from "@iconify-icons/mdi/account-plus-outline";
import camera from "@iconify-icons/mdi/camera-outline";
import happy from "@iconify-icons/mdi/emoticon-happy-outline";

export const ICONS = {
  racket, // "main" / game
  shuttle, // kok / brand
  cash, // uang
  calendar,
  chevronDown,
  checkCircle,
  check,
  clock,
  refresh,
  shield,
  share,
  wallet,
  history,
  chart,
  trophy,
  package: pkg,
  users,
  pencil,
  plus,
  minus,
  alert,
  trash,
  lock,
  key,
  close,
  cart,
  save,
  logout,
  cog,
  accountPlus,
  camera,
  happy,
  back,
} satisfies Record<string, IconifyIcon>;

export type IconName = keyof typeof ICONS;

export function KIcon({
  name,
  className,
}: {
  name: IconName;
  className?: string;
}) {
  return <Icon icon={ICONS[name]} className={className} aria-hidden />;
}
