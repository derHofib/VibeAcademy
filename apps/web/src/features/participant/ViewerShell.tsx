import type { ReactNode, Ref } from 'react';
import { ChevronLeft, LayoutGrid, MessageSquare, X } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { ProgressRing, SegmentProgress } from '@/components/ui/progress';
import { RingButton, type RingButtonState } from '@/components/ui/ring-button';
import { StatusPill, type StatusPillTone } from '@/components/ui/status';
import { cn } from '@/lib/cn';
import { tp } from '@/i18n/participant';
import { ReaderSheet } from './ReaderSheet';
import { DESKTOP_ZOOM, clampZoom, nextMobileZoom } from './viewerModel';

export interface ViewerStatus {
  text: string;
  tone: StatusPillTone;
  pulse?: boolean;
}

export interface ViewerRing {
  state: RingButtonState;
  progress?: number;
  seconds?: number;
  /** Zugänglicher Name (z. B. „Nächste Seite“, „Auswerten“) */
  label: string;
  onClick: () => void;
}

export interface ViewerShellProps {
  desktop: boolean;
  trainingTitle: string;
  /** Mobil: kleine Zeile über dem Titel („Kapitel 2 von 4“) */
  kicker: string;
  /** Mobil: Titel im Kopf („Elektrische Gefährdungen“, „Wissenscheck“) */
  title: string;
  /** Desktop: Zeile unter dem Schulungstitel */
  desktopSub: string;
  /** Gesamtfortschritt 0–1 */
  overall: number;
  segments: number[];
  currentSegment?: number;
  doneCount: number;
  status: ViewerStatus | null;
  ring: ViewerRing | null;
  onClose: () => void;
  onBack: () => void;
  backDisabled?: boolean;
  tocOpen: boolean;
  onTocOpenChange: (open: boolean) => void;
  tocDescription?: string;
  toc: ReactNode;
  askOpen: boolean;
  onAskOpenChange: (open: boolean) => void;
  askTitle: string;
  ask: ReactNode;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  /** Desktop: Kapitel-Leiste */
  rail?: ReactNode;
  cardLabel: string;
  cardRef?: Ref<HTMLElement>;
  /** Inhalt der weißen Karte */
  children: ReactNode;
  /** Überlagerung (z. B. „In einem anderen Fenster geöffnet“) */
  overlay?: ReactNode;
  /** Karteninhalt mittig (Ergebnis-Screen) */
  centerCard?: boolean;
}

const pct = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100);

/**
 * Gemeinsamer Rahmen für Lesen und Wissenscheck (Screens 5b–5j):
 * Kopf mit Segment-Fortschritt, weiße Seitenkarte, Status-Pille, Lese-Dock mit Ring-Button,
 * Inhaltsverzeichnis und „Frage stellen“ als Bottom-Sheet (mobil) bzw. schwebendes Panel (Desktop).
 */
export function ViewerShell(props: ViewerShellProps) {
  return props.desktop ? <DesktopShell {...props} /> : <MobileShell {...props} />;
}

function OverallRing({ value }: { value: number }) {
  return (
    <ProgressRing value={value} size={44} stroke={4} tone="success" fill="#fff" label={tp.reader.overall(pct(value))} valueText={`${pct(value)} %`}>
      <span className="text-[11px] font-bold text-ink">{pct(value)}%</span>
    </ProgressRing>
  );
}

function MobileShell(p: ViewerShellProps) {
  const zoomLabel = tp.reader.dock.zoom(Math.round(p.zoom * 100));
  return (
    <div className="fixed inset-0 overflow-hidden bg-bg">
      <div className="relative mx-auto flex h-full w-full max-w-[560px] flex-col">
        <header className="flex flex-col gap-3 px-3.5 pt-3 pb-3">
          <div className="flex items-center gap-2.5">
            <IconButton aria-label={tp.common.closeTraining} onClick={p.onClose} className="[&_svg]:size-4">
              <X aria-hidden="true" strokeWidth={2.25} />
            </IconButton>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] text-muted">{p.kicker}</p>
              <h1 className="truncate font-heading text-[15px] font-semibold text-ink">{p.title}</h1>
            </div>
            <OverallRing value={p.overall} />
          </div>
          <SegmentProgress segments={p.segments} current={p.currentSegment} className="gap-1 px-0.5" />
        </header>
        <main className="flex min-h-0 flex-1 flex-col px-3.5 pb-[118px]">
          <section
            ref={p.cardRef}
            aria-label={p.cardLabel}
            className={cn(
              'flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto rounded-[26px] bg-surface px-[22px] py-6 shadow-card',
              p.centerCard && 'items-center justify-center text-center',
            )}
            style={{ ['--viewer-zoom' as string]: p.zoom }}
          >
            {p.children}
          </section>
        </main>
        {p.status && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[104px] flex justify-center px-4" aria-live="polite">
            <StatusPill tone={p.status.tone} pulse={p.status.pulse} className={cn('max-w-full', p.status.tone === 'warn' && 'text-ink-2')} data-testid="status-pill">
              <span className="truncate">{p.status.text}</span>
            </StatusPill>
          </div>
        )}
        <nav
          aria-label={tp.reader.dock.label}
          className="absolute inset-x-4 bottom-5 flex h-[72px] items-center rounded-pill bg-surface px-2 shadow-float"
        >
          <DockButton
            icon={<LayoutGrid aria-hidden="true" />}
            label={tp.reader.dock.toc}
            pressed={p.tocOpen}
            onClick={() => p.onTocOpenChange(!p.tocOpen)}
            toggle
          />
          <DockButton icon={<ChevronLeft aria-hidden="true" />} label={tp.reader.dock.back} onClick={p.onBack} disabled={p.backDisabled} />
          <div className="-mt-[30px] flex w-20 shrink-0 justify-center">
            {p.ring && <Ring ring={p.ring} size="mobile" />}
          </div>
          <DockButton
            icon={<MessageSquare aria-hidden="true" />}
            label={tp.reader.dock.ask}
            aria={tp.reader.dock.askAria}
            pressed={p.askOpen}
            onClick={() => p.onAskOpenChange(!p.askOpen)}
            toggle
          />
          <DockButton
            icon={
              <span aria-hidden="true" className="font-heading text-[17px] leading-5 font-bold">
                A<span className="text-[12px]">a</span>
              </span>
            }
            label={zoomLabel}
            srPrefix={tp.reader.dock.zoomGroup}
            onClick={() => p.onZoomChange(nextMobileZoom(p.zoom))}
          />
        </nav>
      </div>
      <Sheets {...p} />
      {p.overlay}
    </div>
  );
}

function DesktopShell(p: ViewerShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex flex-wrap items-center gap-x-7 gap-y-3.5 px-7 pt-[18px] pb-2.5">
        <div className="flex min-w-0 flex-[1_1_260px] items-center gap-3">
          <IconButton aria-label={tp.common.closeTraining} onClick={p.onClose} className="[&_svg]:size-4">
            <X aria-hidden="true" strokeWidth={2.25} />
          </IconButton>
          <div className="min-w-0">
            <h1 className="truncate font-heading text-[16px] font-bold text-ink">{p.trainingTitle}</h1>
            <p className="truncate text-[13px] text-muted">{p.desktopSub}</p>
          </div>
        </div>
        <div className="flex max-w-[460px] flex-[1_1_320px] flex-col gap-[7px]">
          <SegmentProgress segments={p.segments} current={p.currentSegment} className="gap-1 [&>span]:h-1.5" />
          <p className="text-[12.5px] text-muted">{tp.reader.pagesCaptured(p.doneCount, p.segments.length)}</p>
        </div>
        <div className="flex flex-[1_1_220px] justify-end" aria-live="polite">
          {p.status && (
            <StatusPill
              tone={p.status.tone}
              pulse={p.status.pulse}
              className={cn('px-4 py-2.5 text-[13px] shadow-soft', p.status.tone === 'warn' && 'text-ink-2')}
              data-testid="status-pill"
            >
              {p.status.text}
            </StatusPill>
          )}
        </div>
      </header>
      <div className="flex flex-1 items-start gap-8 px-7 pt-2.5">
        {p.rail}
        <main className="flex min-w-0 flex-1 flex-col items-center pb-8">
          <section
            ref={p.cardRef}
            aria-label={p.cardLabel}
            className={cn(
              'flex min-h-[600px] w-full max-w-[720px] flex-col gap-[18px] rounded-[30px] bg-surface px-[52px] pt-[38px] pb-11',
              'shadow-[0_1px_2px_rgba(29,36,51,0.04),0_12px_36px_rgba(29,36,51,0.07)]',
              p.centerCard && 'items-center justify-center text-center',
            )}
            style={{ ['--viewer-zoom' as string]: p.zoom }}
          >
            {p.children}
          </section>
          <nav
            aria-label={tp.reader.dock.label}
            className="sticky bottom-6 z-10 mt-6 flex h-[76px] items-center gap-1 rounded-pill bg-surface px-2.5 shadow-[0_2px_6px_rgba(29,36,51,0.06),0_16px_40px_rgba(29,36,51,0.14)]"
          >
            <DeskDockButton
              icon={<LayoutGrid aria-hidden="true" />}
              label={tp.reader.dock.toc}
              pressed={p.tocOpen}
              onClick={() => p.onTocOpenChange(!p.tocOpen)}
            />
            <DeskDockButton icon={<ChevronLeft aria-hidden="true" />} label={tp.reader.dock.back} onClick={p.onBack} disabled={p.backDisabled} />
            <div className="-mt-[34px] flex w-24 shrink-0 justify-center">{p.ring && <Ring ring={p.ring} size="desktop" />}</div>
            <DeskDockButton
              icon={<MessageSquare aria-hidden="true" />}
              label={tp.reader.dock.ask}
              pressed={p.askOpen}
              onClick={() => p.onAskOpenChange(!p.askOpen)}
            />
            <div role="group" aria-label={tp.reader.dock.zoomGroup} className="flex h-14 items-center rounded-pill bg-bg px-1">
              <button
                type="button"
                disabled={p.zoom <= DESKTOP_ZOOM.min + 0.001}
                onClick={() => p.onZoomChange(clampZoom(p.zoom - DESKTOP_ZOOM.step))}
                className="size-11 cursor-pointer rounded-full text-[13px] font-bold text-ink hover:bg-surface disabled:cursor-not-allowed disabled:text-muted"
              >
                <span aria-hidden="true">A−</span>
                <span className="sr-only">{tp.reader.dock.zoomOut}</span>
              </button>
              <span className="min-w-11 text-center text-[12px] text-muted tabular-nums" aria-live="polite">
                {tp.reader.dock.zoom(Math.round(p.zoom * 100))}
              </span>
              <button
                type="button"
                disabled={p.zoom >= DESKTOP_ZOOM.max - 0.001}
                onClick={() => p.onZoomChange(clampZoom(p.zoom + DESKTOP_ZOOM.step))}
                className="size-11 cursor-pointer rounded-full text-[16px] font-bold text-ink hover:bg-surface disabled:cursor-not-allowed disabled:text-muted"
              >
                <span aria-hidden="true">A+</span>
                <span className="sr-only">{tp.reader.dock.zoomIn}</span>
              </button>
            </div>
          </nav>
        </main>
      </div>
      <Sheets {...p} />
      {p.overlay}
    </div>
  );
}

function Sheets(p: ViewerShellProps) {
  return (
    <>
      <ReaderSheet
        open={p.tocOpen}
        onOpenChange={p.onTocOpenChange}
        title={tp.reader.toc.title}
        description={p.desktop ? undefined : p.tocDescription}
        desktop={p.desktop}
        placement="left"
      >
        {p.toc}
      </ReaderSheet>
      <ReaderSheet open={p.askOpen} onOpenChange={p.onAskOpenChange} title={p.askTitle} desktop={p.desktop} placement="right">
        {p.ask}
      </ReaderSheet>
    </>
  );
}

function Ring({ ring, size }: { ring: ViewerRing; size: 'mobile' | 'desktop' }) {
  // Zustände mit sichtbarem Text („4s“, „?“) behalten den eingebauten Namen (Label-in-Name, WCAG 2.5.3);
  // Icon-Zustände bekommen den passenden Namen („Zum Wissenscheck“, „Auswerten“ …).
  const named = ring.state === 'ready' || ring.state === 'done';
  return (
    <RingButton
      state={ring.state}
      progress={ring.progress}
      seconds={ring.seconds}
      size={size}
      aria-label={named ? ring.label : undefined}
      title={named ? ring.label : undefined}
      onClick={ring.onClick}
      className={cn(size === 'desktop' && 'border-[6px]')}
      data-testid="ring-button"
      data-state={ring.state}
    />
  );
}

function DockButton({
  icon,
  label,
  aria,
  srPrefix,
  onClick,
  disabled,
  pressed,
  toggle,
}: {
  icon: ReactNode;
  label: string;
  aria?: string;
  /** Unsichtbarer Zusatz vor dem sichtbaren Text (z. B. „Schriftgröße“ vor „100 %“) */
  srPrefix?: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  toggle?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={aria}
      aria-expanded={toggle ? !!pressed : undefined}
      data-viewer-toggle={toggle ? '' : undefined}
      className={cn(
        'flex h-[60px] min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-pill text-[11px] font-semibold text-ink-2 [&_svg]:size-5',
        'disabled:cursor-not-allowed disabled:opacity-40',
        pressed ? 'bg-accent-soft' : 'hover:bg-bg',
      )}
    >
      {icon}
      <span className="truncate">
        {srPrefix && <span className="sr-only">{srPrefix} </span>}
        {label}
      </span>
    </button>
  );
}

function DeskDockButton({
  icon,
  label,
  onClick,
  disabled,
  pressed,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
}) {
  const toggle = pressed !== undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={toggle ? pressed : undefined}
      data-viewer-toggle={toggle ? '' : undefined}
      className={cn(
        'flex h-14 cursor-pointer items-center gap-2 rounded-pill px-4 text-[14px] font-semibold text-ink [&_svg]:size-[18px]',
        'disabled:cursor-not-allowed disabled:opacity-40',
        pressed ? 'bg-accent-soft' : 'hover:bg-bg',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
