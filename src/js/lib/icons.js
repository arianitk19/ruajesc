// Lucide icons, imported individually so the bundle only contains icons in use.
// Rendered with createElementNS — no HTML strings.
import {
  AlertTriangle, Archive, ArrowDownUp, BarChart3, Bookmark, BookOpen, Briefcase, Check, CheckCircle2, ChevronLeft,
  ChevronRight, CircleDashed, Clock, Code, Command, Copy, Download, Eye, FileText, Folder, FolderPlus, Globe,
  GraduationCap, HardDrive, Heart, HelpCircle, History, Home, ImagePlus, Images, Info, Layers, LayoutGrid, Lightbulb,
  List, Loader2, Maximize, Maximize2, MessageCircle, Minimize2, Monitor, Moon, MoreHorizontal, PanelLeftClose,
  PanelLeftOpen, Pencil, Plane, Plus, Receipt, RefreshCw, RotateCcw, ScanSearch, ScanText, Search, Settings, Shield,
  ShieldCheck, ShoppingBag, Sparkles, Square, SquareCheck, Star, Sun, Tag, Trash2, Upload, Users, Wallet, WifiOff, X,
  ZoomIn, ZoomOut,
} from 'lucide';

const ICONS = {
  'alert-triangle': AlertTriangle, archive: Archive, 'arrow-down-up': ArrowDownUp, 'bar-chart': BarChart3, bookmark: Bookmark,
  'book-open': BookOpen, briefcase: Briefcase, check: Check, 'check-circle': CheckCircle2, 'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight, 'circle-dashed': CircleDashed, clock: Clock, code: Code, command: Command, copy: Copy,
  download: Download, eye: Eye, 'file-text': FileText, folder: Folder, 'folder-plus': FolderPlus, globe: Globe,
  'graduation-cap': GraduationCap, 'hard-drive': HardDrive, heart: Heart, help: HelpCircle, history: History, home: Home,
  'image-plus': ImagePlus, images: Images, info: Info, layers: Layers, 'layout-grid': LayoutGrid, lightbulb: Lightbulb,
  list: List, loader: Loader2, maximize: Maximize, 'maximize-2': Maximize2, 'message-circle': MessageCircle,
  'minimize-2': Minimize2, monitor: Monitor, moon: Moon, more: MoreHorizontal, 'panel-left-close': PanelLeftClose,
  'panel-left-open': PanelLeftOpen, pencil: Pencil, plane: Plane, plus: Plus, receipt: Receipt, refresh: RefreshCw,
  'rotate-ccw': RotateCcw, 'scan-search': ScanSearch, 'scan-text': ScanText, search: Search, settings: Settings,
  shield: Shield, 'shield-check': ShieldCheck, 'shopping-bag': ShoppingBag, sparkles: Sparkles, square: Square,
  'square-check': SquareCheck, star: Star, sun: Sun, tag: Tag, trash: Trash2, upload: Upload, users: Users,
  wallet: Wallet, 'wifi-off': WifiOff, x: X, 'zoom-in': ZoomIn, 'zoom-out': ZoomOut,
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, { size = 18, className = '', label = null, strokeWidth = 1.75 } = {}) {
  const node = ICONS[name] ?? ICONS['circle-dashed'];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(strokeWidth));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', `icon ${className}`.trim());
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
  }
  for (const [tag, attrs] of node) {
    const child = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) child.setAttribute(k, String(v));
    svg.append(child);
  }
  return svg;
}

export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}
