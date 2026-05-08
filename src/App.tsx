import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { 
  Upload, 
  Package, 
  FileText, 
  Download, 
  Trash2, 
  Plus, 
  X,
  Layers, 
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Hash,
  ArrowRight,
  Settings,
  LayoutGrid,
  History,
  Sliders,
  FolderOpen,
  PieChart,
  Target,
  GripVertical,
  Eye,
  RefreshCw,
  Search,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import JSZip from 'jszip';

// --- Constants & Mappings ---

const CATEGORY_MAP: Record<string, string> = {
  "静物/物品": "still_life",
  "人文景观": "humanities",
  "艺术/插画": "art",
  "动物": "animal",
  "建筑": "architecture",
  "自然景观": "nature",
  "食物": "food",
  "人物": "people",
  "其他": "others"
};

// 小品类到大品类的智能关联表（用户可操作）
const INITIAL_TAG_MAP: Record<string, string> = {
  "摄影": "静物/物品",
  "写实": "静物/物品",
  "中国风": "艺术/插画",
  "动漫": "艺术/插画",
  "二次元": "艺术/插画",
  "油画": "艺术/插画",
  "水彩": "艺术/插画",
  "宠物": "动物",
  "城市": "建筑",
  "风景": "自然景观",
  "肖像": "人物",
  "美食": "食物",
  "冰淇淋": "食物",
  "甜品": "食物",
  "素材": "静物/物品",
  "特写": "静物/物品"
};

const SATURATION_MAP: Record<string, string> = {
  "高": "high",
  "中": "mid",
  "低": "low"
};

const DIFFICULTY_MAP: Record<string, string> = {
  "简单": "easy",
  "普通": "normal",
  "困难": "hard"
};

// --- Types ---

interface AssetHistory {
  category?: string;
  subCategory?: string;
  saturation?: string;
  difficulty?: string;
}

interface Asset {
  id: string;
  name: string;
  file: File;
  pieceSize: 4 | 6;
  fullPath: string; 
  previewUrl: string; 
  category?: string;     // 主品类
  subCategory?: string;  // 小品类
  saturation?: string;   // "高" | "中" | "低"
  difficulty?: string;   // "简单" | "普通" | "困难"
  hasAutoMeta?: boolean; // 是否通过 JSON 自动识别
  tags?: string[];       // 原始标签数据，用于智能推荐
}

interface NamingComponent {
  id: 'seq' | 'cat' | 'subcat' | 'sat' | 'diff' | 'name';
  label: string;
  enabled: boolean;
}

interface PendingBatch {
  id: string;
  folderName: string;
  files: File[];
  count: number;
  limit: number;
  metaCount?: number; // 匹配到的 JSON 文件数量
}

interface LevelPlan {
  id: string; 
  level_no: number;
  pic_id: string;
  piece_size: number;
  difficulty: number;
  source_path: string;
  asset: Asset; 
  violations?: string[];
}

// --- Python Template ---
const generatePythonScript = (planCsvName: string, batchSize: number) => `
import os
import csv
import shutil
import json
import sys
from datetime import datetime

# --- Configuration ---
PLAN_CSV = "${planCsvName}"
OUTPUT_ROOT = "Packed_Game_Levels"
BATCH_SIZE = ${batchSize}

def normalize_path(path):
    # Normalize slashes for the current OS
    return os.path.normpath(path.replace('\\\\', '/'))

def generate_internal_csv(levels, folder_path):
    csv_path = os.path.join(folder_path, "game_level_config.csv")
    try:
        # Using utf-8-sig for better compatibility with Excel in Chinese environments
        with open(csv_path, 'w', newline='', encoding='utf-8-sig') as f:
            writer = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
            writer.writerow(["level_no", "pic_id", "piece_size", "difficulty"])
            writer.writerow(["", "", "", ""]) # SOP: Second row MUST be empty
            for l in levels:
                writer.writerow([l['level_no'], l['pic_id'], l['piece_size'], l['difficulty']])
        return True
    except Exception as e:
        print(f"  [ERROR] Failed to write CSV {csv_path}: {e}")
        return False

def run_packer():
    print("="*60)
    print("LEVEL PACK MASTER - LOCAL PACKER ENGINE v3.1")
    print("="*60)

    if not os.path.exists(PLAN_CSV):
        print(f"FAILED: {PLAN_CSV} not found!")
        print("Please place this script and the CSV in the SAME directory as your 4x4/6x6 asset folders.")
        return

    if os.path.exists(OUTPUT_ROOT):
        print(f"Cleaning existing output directory: {OUTPUT_ROOT}")
        try:
            shutil.rmtree(OUTPUT_ROOT)
        except Exception as e:
            print(f"Warning: Could not clean {OUTPUT_ROOT}: {e}")
    
    os.makedirs(OUTPUT_ROOT, exist_ok=True)

    levels_data = []
    print(f"Reading Plan: {PLAN_CSV}...")
    try:
        with open(PLAN_CSV, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            # Filter all rows that don't have a numeric level_no to avoid SOP empty row errors
            levels_data = []
            for row in reader:
                l_no = row.get('level_no', '').strip()
                if l_no and l_no.isdigit():
                    levels_data.append(row)
    except Exception as e:
        print(f"FAILED to read CSV plan: {e}")
        return

    if not levels_data:
        print("FAILED: No level data found in the CSV plan.")
        return

    total_levels = len(levels_data)
    batches = [levels_data[i:i + BATCH_SIZE] for i in range(0, total_levels, BATCH_SIZE)]

    print(f"Total Levels in Plan: {total_levels}")
    print(f"Total Folders to Create: {len(batches)}")
    print("-" * 60)

    resource_config = []
    global_failed_count = 0

    for idx, batch in enumerate(batches):
        start_lv = batch[0]['level_no']
        end_lv = batch[-1]['level_no']
        folder_name = f"{start_lv}-{end_lv}"
        folder_path = os.path.join(OUTPUT_ROOT, folder_name)
        os.makedirs(folder_path, exist_ok=True)

        batch_progress = f"[{idx+1}/{len(batches)}]"
        print(f"{batch_progress} Working on Batch: {folder_name}")

        for level in batch:
            l_no = level['level_no']
            p_id = level['pic_id']
            raw_src = level['source_path']
            
            # Use pic_id as filename (restore previous naming)
            dst = os.path.join(folder_path, f"{p_id}.png")
            
            found = False
            # Generate potential search paths based on the provided source_path
            # We try: 
            # 1. Absolute/Relative path as provided
            # 2. Stripping leading directory (often added by webkitdirectory)
            search_candidates = []
            
            # Candidate 1: Normalized raw path
            norm_raw = normalize_path(raw_src)
            search_candidates.append(norm_raw)
            
            # Candidate 2: Strip the first folder (e.g. 'Animals/cat.png' -> 'cat.png')
            parts = raw_src.replace('\\\\', '/').split('/')
            if len(parts) > 1:
                search_candidates.append(normalize_path('/'.join(parts[1:])))
                
            # Candidate 3: Just the filename in the current directory
            search_candidates.append(normalize_path(parts[-1]))

            for cand in search_candidates:
                if os.path.exists(cand):
                    try:
                        shutil.copy2(cand, dst)
                        found = True
                        break
                    except Exception as e:
                        print(f"    [ERR] Level {l_no}: Copy failed for {cand}: {e}")
            
            if not found:
                print(f"    [MISSING] Level {l_no} (ID: {p_id})")
                print(f"      Tried: {search_candidates}")
                global_failed_count += 1

        # Check folder completeness for this batch
        files_in_batch = [f for f in os.listdir(folder_path) if f.endswith('.png')]
        if len(files_in_batch) < len(batch):
            print(f"    [WARNING] !!! Batch {folder_name} is INCOMPLETE! Expecting 50 files, but only got {len(files_in_batch)}.")
            # Map of expected vs actual
            expected_ids = [f"{l['pic_id']}.png" for l in batch]
            missing = [eid for eid in expected_ids if eid not in files_in_batch]
            print(f"    [DETAIL] Missing these specific files in batch: {missing}")

        generate_internal_csv(batch, folder_path)
        
        resource_config.append({
            "index": idx,
            "url": "",
            "crc": f"CRC_{datetime.now().microsecond}",
            "down_level": int(start_lv),
            "up_level": int(end_lv)
        })

    # Global Resource Config
    today = datetime.now().strftime("%Y%m%d")
    json_name = f"level_resource_config_{today}.json"
    json_path = os.path.join(OUTPUT_ROOT, json_name)
    try:
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(resource_config, f, indent=2)
    except Exception as e:
        print(f"Warning: Failed to write global config {json_name}: {e}")

    print("\\n" + "="*60)
    print("SUCCESS: LOCAL PACKING FINISHED")
    print("-" * 60)
    
    # Sanity check: ensure every level from the original plan has a corresponding file
    all_l_nos = [int(l['level_no']) for l in levels_data]
    missing_in_output = []
    
    # Pre-scan output root
    all_files_set = set()
    for root, dirs, files in os.walk(OUTPUT_ROOT):
        for f in files:
            if f.endswith(".png"):
                all_files_set.add(f.replace(".png", ""))

    for l_no in all_l_nos:
        if str(l_no) not in all_files_set:
            missing_in_output.append(l_no)

    print(f"Total Batches Processed: {len(batches)}")
    print(f"Total Files Missing (Src): {global_failed_count}")
    
    if missing_in_output:
        print(f"CRITICAL: {len(missing_in_output)} levels are missing in the final output folder!")
        print(f"Missing level numbers: {missing_in_output[:50]}")
    else:
        print("VERIFIED: All levels (from %d to %d) are present in the output directory." % (min(all_l_nos), max(all_l_nos)))
    
    print(f"Output Directory:       {os.path.abspath(OUTPUT_ROOT)}")
    print(f"Config File:            {json_name}")
    print("="*60)
    if global_failed_count > 0:
        print("HINT: Some files were missing. Check the log output above for specific paths.")

if __name__ == "__main__":
    run_packer()
`;

export default function App() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [pendingBatches, setPendingBatches] = useState<PendingBatch[]>([]);
  const [plan, setPlan] = useState<LevelPlan[]>([]); 
  const [startLevel, setStartLevel] = useState(1);
  const [batchCount, setBatchCount] = useState(1);
  const [categoryGap, setCategoryGap] = useState(5); 
  const [saturationGap, setSaturationGap] = useState(3);
  const [difficultySequence, setDifficultySequence] = useState<string[]>(["简单", "普通", "普通", "困难"]);
  const [activeTab, setActiveTab] = useState<'upload' | 'categorization' | 'properties' | 'sequence' | 'pack'>('upload');
  const [namingScheme, setNamingScheme] = useState<NamingComponent[]>([
    { id: 'seq', label: '关卡序列', enabled: true },
    { id: 'cat', label: '主品类', enabled: true },
    { id: 'subcat', label: '小品类', enabled: true },
    { id: 'sat', label: '饱和度', enabled: false },
    { id: 'diff', label: '难度', enabled: false },
    { id: 'name', label: '原文件名', enabled: true },
  ]);

  // --- Tag-to-Minor Recommendation System (Expert Intelligence) ---
  const GENERIC_TAGS = ['静物', '图片', '背景', '素材', '高清', '摄影', '设计', '艺术', '插画', '高清图片'];
  
  // Persistence Key
  const HISTORY_KEY = 'ais_asset_tag_history_v1';

  const [recommendedSubCats, setRecommendedSubCats] = useState<string[]>([]);
  const [tagToMajorMap, setTagToMajorMap] = useState<Record<string, string>>(INITIAL_TAG_MAP);
  
  // 智能提取推荐标签
  useMemo(() => {
    const freq: Record<string, number> = {};
    assets.forEach(a => {
      if (a.tags) {
        a.tags.forEach(t => {
          if (!GENERIC_TAGS.includes(t) && t.length > 1) {
            freq[t] = (freq[t] || 0) + 1;
          }
        });
      }
    });
    
    const sorted = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([name]) => name);
    
    setRecommendedSubCats(sorted);
  }, [assets]);
  const [levelsPerPack, setLevelsPerPack] = useState(20);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [batchCategory, setBatchCategory] = useState<string>('');
  const [batchSubCategory, setBatchSubCategory] = useState<string>('');
  const [selectedAssetIdsForTagging, setSelectedAssetIdsForTagging] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    assetId: string | null;
  }>({ x: 0, y: 0, assetId: null });
  
  // Ratio / Weight States
  const [satWeights, setSatWeights] = useState<Record<string, number>>({
    "高": 40,
    "中": 40,
    "低": 20
  });
  const [diffWeights, setDiffWeights] = useState<Record<string, number>>({
    "困难": 30,
    "普通": 50,
    "简单": 20
  });

  const [categoryTargetCounts, setCategoryTargetCounts] = useState<Record<string, number>>({
    "静物/物品": 12,
    "人文景观": 10,
    "艺术/插画": 15,
    "动物": 8,
    "建筑": 12,
    "自然景观": 10,
    "食物": 8,
    "人物": 6,
    "其他": 4
  });

  const [labelDisplayLimit, setLabelDisplayLimit] = useState<number>(10);

  const allCategories = useMemo(() => [...Object.keys(CATEGORY_MAP), ...customCategories], [customCategories]);

  // Helper: Sanitize fileName (replace Chinese and spaces with underscores)
  const sanitizeFileName = (name: string) => {
    return name.replace(/[^\x00-\x7F]/g, "_").replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_");
  };

  // Helper: Build the complete file name according to user priority rules
  const buildFileName = useCallback((lNo: number, pSize: number, asset: Asset) => {
    const components = namingScheme.filter(c => c.enabled);
    const parts: string[] = [];

    components.forEach(comp => {
      if (comp.id === 'seq') {
        parts.push(`${lNo}_piece${pSize}`);
      } else if (comp.id === 'cat') {
        const catName = asset.category || "none";
        const catEng = CATEGORY_MAP[catName] || `custom_${sanitizeFileName(catName).toLowerCase()}`;
        parts.push(catEng);
      } else if (comp.id === 'subcat') {
        if (asset.subCategory) {
          parts.push(sanitizeFileName(asset.subCategory).toLowerCase());
        }
      } else if (comp.id === 'name') {
        parts.push(sanitizeFileName(asset.name.split('.')[0]));
      } else if (comp.id === 'sat') {
        if (asset.saturation) {
          const satEng = SATURATION_MAP[asset.saturation];
          if (satEng) parts.push(satEng);
        }
      } else if (comp.id === 'diff') {
        if (asset.difficulty) {
          const diffEng = DIFFICULTY_MAP[asset.difficulty];
          if (diffEng) parts.push(diffEng);
        }
      }
    });

    return parts.join('_').replace(/_+/g, "_");
  }, [namingScheme]);

  // Re-calculate the plan sequence (IDs and indices) whenever the plan array changes its order
  const reindexPlan = useCallback((newPlan: LevelPlan[]) => {
    return newPlan.map((p, index) => {
      const currentLNo = startLevel + index;
      // Difficulty bound to piece_size: 6x6 -> 1, 4x4 -> 0
      const finalDiff = p.piece_size === 6 ? 1 : 0;
      return {
        ...p,
        level_no: currentLNo,
        difficulty: finalDiff,
        pic_id: buildFileName(currentLNo, p.piece_size, p.asset),
      };
    });
  }, [startLevel, buildFileName]);

  const onPlanOrderChange = (newOrder: LevelPlan[]) => {
    setPlan(reindexPlan(newOrder));
  };

  // Keep plan pic_ids in sync with namingScheme or startLevel changes
  // We avoid infinite loop by not including 'plan' as a dependency directly
  // unless we are sure setPlan doesn't trigger it again.
  // Actually, reindexPlan is stable unless buildFileName/startLevel change.
  const prevSchemeRef = useRef(JSON.stringify(namingScheme));
  const prevStartLevelRef = useRef(startLevel);

  if (prevSchemeRef.current !== JSON.stringify(namingScheme) || prevStartLevelRef.current !== startLevel) {
    if (plan.length > 0) {
      const updated = reindexPlan(plan);
      // We check if it actually changed to avoid redundant sets
      if (JSON.stringify(updated.map(p => p.pic_id)) !== JSON.stringify(plan.map(p => p.pic_id))) {
        setPlan(updated);
      }
    }
    prevSchemeRef.current = JSON.stringify(namingScheme);
    prevStartLevelRef.current = startLevel;
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(i => i !== id);
      }
      const newSelection = [...prev, id];
      
      // If we have 2 selected, perform swap
      if (newSelection.length === 2) {
        const indexA = plan.findIndex(p => p.id === newSelection[0]);
        const indexB = plan.findIndex(p => p.id === newSelection[1]);
        
        if (indexA !== -1 && indexB !== -1) {
          const newPlan = [...plan];
          const temp = newPlan[indexA];
          newPlan[indexA] = newPlan[indexB];
          newPlan[indexB] = temp;
          
          setPlan(reindexPlan(newPlan));
        }
        return []; // Clear selection after swap
      }
      return newSelection;
    });
  };
  
  // Weights: Size -> Theme -> Weight
  const [themeWeights, setThemeWeights] = useState<Record<string, number>>({});

  // Helper: Shuffle array
  const shuffle = <T,>(array: T[]) => {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };


  const onFolderSelected = async (files: FileList | null) => {
    if (!files) return;
    const allFiles = Array.from(files);
    
    // Detect PNGs and JSONs
    const images = allFiles.filter(f => /\.png$/i.test(f.name));
    const metas = allFiles.filter(f => /\.json$/i.test(f.name));

    if (images.length === 0) {
      alert('所选文件夹中未检测到有效的 PNG 图片。');
      return;
    }

    const firstValidFile = images[0];
    const path = (firstValidFile as any).webkitRelativePath;
    const folderName = path ? path.split('/')[0] : "手动选片";
    
    const newBatch: PendingBatch = {
      id: Math.random().toString(36).substr(2, 9),
      folderName,
      files: images,
      count: images.length,
      limit: images.length,
      metaCount: metas.length
    };

    // Store metadata files implicitly by keeping them in a temporary map if we want to read them later
    // Or we can just store the meta files in the batch. 
    // Let's add 'metas' to PendingBatch type or just handle it here.
    
    // We'll read the metas now and store them in a way confirmImport can use
    const metaMap: Record<string, any> = {};
    for (const metaFile of metas) {
      try {
        const text = await metaFile.text();
        const json = JSON.parse(text);
        // Matching key: lowercase name without extension
        const baseMatchKey = metaFile.name.replace(/\.json$/i, '').toLowerCase().trim();
        metaMap[baseMatchKey] = json;
      } catch (e) {
        console.error("Failed to parse meta:", metaFile.name, e);
      }
    }

    // Attach meta data to the batch (simulated via a closure or ref)
    (newBatch as any).metaMap = metaMap;

    setPendingBatches(prev => [...prev, newBatch]);
  };

  const updateBatchLimit = (id: string, val: number) => {
    setPendingBatches(prev => prev.map(b => 
      b.id === id ? { ...b, limit: Math.max(0, Math.min(b.count, val)) } : b
    ));
  };

  const removeBatch = (id: string) => {
    setPendingBatches(prev => prev.filter(b => b.id !== id));
  };

  const importAllBatches = () => {
    pendingBatches.forEach(b => confirmImport(b));
  };

  const confirmImport = (batch: PendingBatch) => {
    const shuffledFiles = shuffle([...batch.files]);
    const selectedFiles = shuffledFiles.slice(0, batch.limit);
    const metaMap = (batch as any).metaMap || {};
    
    // Load local history for smarter recognition
    const historyRaw = localStorage.getItem(HISTORY_KEY);
    const history: Record<string, AssetHistory> = historyRaw ? JSON.parse(historyRaw) : {};

    const detectedStyles = new Set<string>();
    
    const newAssets: Asset[] = selectedFiles.map(file => {
      const fileName = file.name;
      const fileSize = file.size;
      const historyKey = `${fileName}_${fileSize}`;
      const lastDotIndex = fileName.lastIndexOf('.');
      const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
      const baseMatchKey = baseName.toLowerCase().trim();
      const fullPath = (file as any).webkitRelativePath || file.name;

      // 1. First priority: Local persistence history
      const savedMeta = history[historyKey];

      const meta = metaMap[baseMatchKey];
      let pieceSize: 4 | 6 = 4;
      let difficulty: string | undefined = savedMeta?.difficulty;
      let category: string | undefined = savedMeta?.category;
      let subCategory: string | undefined = savedMeta?.subCategory;
      let saturation: string | undefined = savedMeta?.saturation;
      let hasAutoMeta = !!savedMeta;

      // 强化版匹配逻辑：全字典扫描 (Only if no saved meta)
      if (!savedMeta) {
        let matchingMeta = meta;
        if (!matchingMeta) {
          const potentialMatches = Object.values(metaMap).filter((m: any) => {
            const mSource = (m.source_filename || m.original_filename || m.filename || m.source || m.task_id || "").toLowerCase().trim();
            const fName = file.name.toLowerCase().trim();
            const cleanM = mSource.replace(/\.(png|jpg|jpeg|json)$/i, '');
            const cleanF = fName.replace(/\.(png|jpg|jpeg|json)$/i, '');
            return cleanM === cleanF || cleanM.includes(cleanF) || cleanF.includes(cleanM);
          });
          if (potentialMatches.length > 0) {
            matchingMeta = potentialMatches[0];
          }
        }

        if (matchingMeta) {
          hasAutoMeta = true;
          // 1. 切块数识别
          if (matchingMeta.puzzle_grid_label) {
            const match = matchingMeta.puzzle_grid_label.match(/(\d+)x/i);
            if (match && parseInt(match[1]) === 6) pieceSize = 6;
          }
          // 2. 难度识别
          if (matchingMeta.level_difficulty_label) {
            const dl = matchingMeta.level_difficulty_label.toUpperCase();
            if (dl.includes('HARD')) difficulty = '困难';
            else if (dl.includes('EASY')) difficulty = '简单';
            else difficulty = '普通';
          } else if (matchingMeta.step_level) {
            const lv = matchingMeta.step_level;
            if (lv === '简单' || lv === 'easy') difficulty = '简单';
            else if (lv === '困难' || lv === 'hard') difficulty = '困难';
            else difficulty = '普通';
          }

          // 3. 饱和度识别
          if (matchingMeta.saturation_label) {
            const sl = matchingMeta.saturation_label;
            if (sl.includes('高')) saturation = '高';
            else if (sl.includes('低')) saturation = '低';
            else saturation = '中';
          } else {
            const aiStyleStr = matchingMeta.ai_analysis?.style || "";
            const aiDescStr = matchingMeta.ai_analysis?.description || "";
            const combinedStyleInfo = (aiStyleStr + aiDescStr).toLowerCase();
            if (combinedStyleInfo.includes("high-saturation") || combinedStyleInfo.includes("高饱和") || combinedStyleInfo.includes("鲜艳")) {
              saturation = "高";
            } else if (combinedStyleInfo.includes("low-saturation") || combinedStyleInfo.includes("低饱和") || combinedStyleInfo.includes("淡雅") || combinedStyleInfo.includes("柔和")) {
              saturation = "低";
            } else {
              saturation = "中";
            }
          }

          // 4. 品类与标签
          const tags: string[] = matchingMeta.tags || [];
          const styleKeywords = ["摄影", "油画", "水彩", "3D", "动漫", "二次元", "极简", "像素", "写实", "中国风", "剪纸", "复古", "梦幻", "纪实", "特写", "特写摄影"];
          const aiInfo = `${matchingMeta.ai_analysis?.description || ''} ${matchingMeta.ai_analysis?.style || ''}`.toLowerCase();
          
          subCategory = tags.find(t => styleKeywords.some(s => t.includes(s)));
          if (!subCategory) {
            subCategory = styleKeywords.find(s => aiInfo.includes(s.toLowerCase()));
          }
          if (subCategory) detectedStyles.add(subCategory);

          // 优先从元数据的大类字段识别
          const metaCat = matchingMeta.category;
          if (metaCat) {
            const foundKey = Object.keys(CATEGORY_MAP).find(k => 
              k === metaCat || CATEGORY_MAP[k] === metaCat || metaCat.includes(k)
            );
            category = foundKey;
          }

          // 如果没识别到，尝试从标签映射
          if (!category && tags.length > 0) {
            for (const tag of tags) {
              if (INITIAL_TAG_MAP[tag]) {
                category = INITIAL_TAG_MAP[tag];
                break;
              }
              // 模糊匹配标签
              const matchedTag = Object.keys(INITIAL_TAG_MAP).find(k => tag.includes(k));
              if (matchedTag) {
                category = INITIAL_TAG_MAP[matchedTag];
                break;
              }
            }
          }
        }
      }

      // 5. 路径兜底与 Mapping 反推
      const fullPathLower = fullPath.toLowerCase();
      const CATEGORY_KEYWORDS: Record<string, string[]> = {
        "静物/物品": ["still_life", "object", "item", "still", "物品", "静物"],
        "人文景观": ["humanities", "culture", "street", "human", "人文"],
        "艺术/插画": ["art", "illustration", "painting", "draw", "艺术", "插图", "动漫", "二次元"],
        "动物": ["animal", "pet", "dog", "cat", "bird", "动物", "宠物"],
        "建筑": ["architecture", "building", "house", "city", "建筑"],
        "自然景观": ["nature", "scenery", "landscape", "travel", "风景", "自然"],
        "食物": ["food", "cooking", "cake", "fruit", "dessert", "食物", "美食"],
        "人物": ["people", "person", "human", "portrait", "人物", "肖像"],
      };

      if (!category) {
        for (const [major, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
          if (keywords.some(kw => fullPathLower.includes(kw))) {
            category = major;
            break;
          }
        }
      }

      // 进一步通过 subCategory 反推 category
      if (!category && subCategory && INITIAL_TAG_MAP[subCategory]) {
        category = INITIAL_TAG_MAP[subCategory];
      }

      if (!category) category = "其他";
      if (!difficulty) difficulty = "普通";
      if (!saturation) saturation = "中";

      return {
        id: Math.random().toString(36).substr(2, 9),
        name: baseName,
        file,
        fullPath,
        pieceSize,
        difficulty,
        category,
        subCategory,
  previewUrl: URL.createObjectURL(file), // Add this line
        saturation,
        hasAutoMeta,
        tags: (matchingMeta as any)?.tags || []
      };
    });

    if (detectedStyles.size > 0) {
      setCustomCategories(prev => {
        const next = [...prev];
        detectedStyles.forEach(s => {
          if (!next.includes(s)) next.push(s);
        });
        return next;
      });
    }

    setAssets(prev => [...prev, ...newAssets]);
    setPendingBatches(prev => prev.filter(b => b.id !== batch.id));
  };

  useEffect(() => {
    const handleClick = () => setContextMenu({ x: 0, y: 0, assetId: null });
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  const updateAssetProps = (id: string, props: Partial<Asset>) => {
    setAssets(prev => {
      const newAssets = prev.map(a => a.id === id ? { ...a, ...props } : a);
      
      // Persist to history
      const affectedAsset = newAssets.find(a => a.id === id);
      if (affectedAsset) {
        const historyRaw = localStorage.getItem(HISTORY_KEY);
        const history: Record<string, AssetHistory> = historyRaw ? JSON.parse(historyRaw) : {};
        const historyKey = `${affectedAsset.file.name}_${affectedAsset.file.size}`;
        
        history[historyKey] = {
          category: affectedAsset.category,
          subCategory: affectedAsset.subCategory,
          saturation: affectedAsset.saturation,
          difficulty: affectedAsset.difficulty,
        };
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      }
      
      return newAssets;
    });
  };

  const updateThemeWeight = (theme: string, val: number) => {
    setThemeWeights(prev => ({ ...prev, [theme]: val }));
  };

  const poolStats = useMemo(() => ({
    4: assets.filter(a => a.pieceSize === 4).length,
    6: assets.filter(a => a.pieceSize === 6).length,
  }), [assets]);

  const generatePlan = useCallback(async () => {
    if (isGenerating) return;
    
    if (assets.length === 0) {
      alert('请先上传素材后再进行打包。');
      return;
    }

    setIsGenerating(true);
    
    const tempPlan: LevelPlan[] = [];
    try {
      const validAssetPool = assets.filter(a => a.pieceSize === 4 || a.pieceSize === 6);
      
      // Goal: Use all assets (Input = Output)
      const levelsToGenerate = validAssetPool.length;
      
      let levelsCreated = 0;
      let currentLNo = startLevel;

      const usedAssetIds = new Set<string>();

      // Tracking for violations over the sequence
      const difficultySequenceArray = difficultySequence || [0, 1, 0, 1]; // Fallback

      // Pre-build saturation goal for the current batch (just use probability)
      const getDesiredSat = () => {
        const rand = Math.random() * 100;
        let cumulative = 0;
        for (const [sat, weight] of Object.entries(satWeights)) {
          cumulative += (weight as number);
          if (rand <= cumulative) return sat;
        }
        return null;
      };

      const getDesiredDiff = () => {
        const rand = Math.random() * 100;
        let cumulative = 0;
        for (const [diff, weight] of Object.entries(diffWeights)) {
          cumulative += (weight as number);
          if (rand <= cumulative) return diff;
        }
        return null;
      };

      while (levelsCreated < levelsToGenerate) {
        // 1. IRON RULES: Uniqueness (Non-negotiable)
        const targetSize = ([4, 4, 6] as (4|6)[])[levelsCreated % 3];
        const desiredSat = getDesiredSat();
        const desiredDiff = difficultySequenceArray[levelsCreated % difficultySequenceArray.length];
        
        // Track recent constraints for Gaps (Note: Using Major Category for avoidance)
        const recentCategories = new Set(
          tempPlan.slice(Math.max(0, tempPlan.length - categoryGap))
            .map(p => p.asset.category)
            .filter(Boolean)
        );
        const recentSaturations = new Set(
          tempPlan.slice(Math.max(0, tempPlan.length - saturationGap))
            .map(p => p.asset.saturation)
            .filter(Boolean)
        );

        // Find the last use index (though we aim for unique, this helps the scoring if we ever allow reuse)
        const lastUsedIndices = new Map<string, number>();
        tempPlan.forEach((p, idx) => {
          if (p.asset.id) lastUsedIndices.set(p.asset.id, idx);
        });

        // 2. SMART FALLBACK MATCHING (Heuristic Scoring)
        // Evaluation Priority: Size Cycle > Category Gap > Difficulty Alignment > Saturation Goal
        const scoredAssets = validAssetPool.map(a => {
          let score = 0;
          const isUnique = !usedAssetIds.has(a.id);
          
          // IRON RULE BONUS (Uniqueness - massive weight, we MUST use every asset exactly once)
          if (!isUnique) {
            score -= 1000000; // Penalize used assets heavily so we pick unique ones first
          } else {
            score += 1000000;
          }

          // Priority 1: Size Cycle (4-4-6) (+10000 pts)
          const sizeMatches = a.pieceSize === targetSize;
          if (sizeMatches) score += 10000;

          // Priority 2: Category Gap (+1000 pts)
          const categoryIsSafe = !a.category || !recentCategories.has(a.category);
          if (categoryIsSafe) score += 1000;
          
          // Priority 3: Difficulty Alignment (+100 pts)
          const difficultyMatches = a.difficulty === desiredDiff;
          if (difficultyMatches) score += 100;
          
          // Priority 4: Saturation Match (+10 pts)
          const saturationMatches = a.saturation === desiredSat;
          if (saturationMatches) score += 10;
          
          // Priority 5: Saturation Gap avoidance (+1 pt)
          const saturationIsSafe = !a.saturation || !recentSaturations.has(a.saturation);
          if (saturationIsSafe) score += 1;
          
          return { asset: a, score };
        });

        // Pick from the best candidates
        const maxScore = Math.max(...scoredAssets.map(s => s.score));
        const winners = scoredAssets.filter(s => s.score === maxScore).map(s => s.asset);
        
        const selectedAsset: Asset | undefined = winners[Math.floor(Math.random() * winners.length)];

        if (!selectedAsset) break;

        usedAssetIds.add(selectedAsset.id);

        // Detect Violations for UI marking
        const levelViolations: string[] = [];
        if (selectedAsset.pieceSize !== targetSize) levelViolations.push('SIZE_CYCLE');
        if (selectedAsset.category && recentCategories.has(selectedAsset.category)) levelViolations.push('CATEGORY_GAP');
        if (selectedAsset.difficulty !== desiredDiff) levelViolations.push('DIFFICULTY');
        if (desiredSat && selectedAsset.saturation !== desiredSat) levelViolations.push('SATURATION');

        const finalDifficultyIdx = selectedAsset.pieceSize === 6 ? 1 : 0;

        tempPlan.push({
          id: `plan-${currentLNo}-${Math.random().toString(36).substr(2, 5)}`,
          level_no: currentLNo,
          pic_id: buildFileName(currentLNo, selectedAsset.pieceSize, selectedAsset),
          piece_size: selectedAsset.pieceSize,
          difficulty: finalDifficultyIdx,
          source_path: selectedAsset.fullPath,
          asset: selectedAsset,
          violations: levelViolations
        });

        levelsCreated++;
        currentLNo++;
      }

      setPlan(tempPlan);
      setActiveTab('sequence');
    } catch (err) {
      console.error('Generation Error:', err);
    } finally {
      setIsGenerating(false);
    }
  }, [assets, batchCount, startLevel, isGenerating, buildFileName, satWeights, diffWeights, categoryGap, saturationGap, difficultySequence]);

  const exportZip = useCallback(async () => {
    if (plan.length === 0 || isZipping) return;
    setIsZipping(true);

    try {
      const zip = new JSZip();
      
      const planName = `packer_plan_${startLevel}.csv`;
      
      // 1. Create packer_plan.csv 
      // Headers: level_no,pic_id,piece_size,difficulty,source_path
      // The Python script will handle skipping rows that don't have a valid level_no
      let csvLines = ["level_no,pic_id,piece_size,difficulty,source_path"];
      // Add the SOP blank row (per user requirement)
      csvLines.push(",,,,");
      
      plan.forEach(item => {
        // Difficulty bound to piece_size: 6x6 -> 1, 4x4 -> 0
        const finalDiff = item.piece_size === 6 ? 1 : 0;
        csvLines.push(`${item.level_no},${item.pic_id},${item.piece_size},${finalDiff},${item.source_path}`);
      });
      
      zip.file(planName, csvLines.join("\n"));

      // 2. Add Helper Script
      zip.file("run_packer.py", generatePythonScript(planName, levelsPerPack));

      // 3. Generate Statistics Report (Brief)
      const s4 = plan.filter(p => p.piece_size === 4).length;
      const s6 = plan.filter(p => p.piece_size === 6).length;
      let statsMd = "# 关卡导出报告\n\n";
      statsMd += `| 导出范围 | 总关卡 | 4x4 | 6x6 |\n`;
      statsMd += `| :--- | :--- | :--- | :--- |\n`;
      statsMd += `| ${plan[0].level_no} - ${plan[plan.length-1].level_no} | ${plan.length} | ${s4} | ${s6} |\n\n`;
      
      statsMd += "## 编排策略参数\n";
      statsMd += `- **起始序号**: ${startLevel}\n`;
      statsMd += `- **品类避让间隔**: ${categoryGap}\n`;
      statsMd += `- **饱和度避让间隔**: ${saturationGap}\n`;
      statsMd += `- **难度循环序列**: ${difficultySequence.join(" -> ")}\n\n`;
      
      statsMd += "### 权重分布 (配置快照)\n";
      statsMd += "#### 饱和度分布\n";
      for (const [k, v] of Object.entries(satWeights)) {
        statsMd += `- ${k}: ${v}%\n`;
      }
      statsMd += "\n#### 难度分布\n";
      for (const [k, v] of Object.entries(diffWeights)) {
        statsMd += `- ${k}: ${v}%\n`;
      }
      
      zip.file("README.md", statsMd);

      const content = await zip.generateAsync({ 
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });
      
      const url = URL.createObjectURL(content);
      const link = document.body.appendChild(document.createElement('a'));
      link.href = url;
      link.download = `Packer_Toolkit_${startLevel}.zip`;
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      alert(`导出成功！ZIP 包内已包含 Python 脚本和 CSV 计划文件。`);
    } catch (err) {
      console.error('Export Error:', err);
      alert(`导出失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsZipping(false);
    }
  }, [plan, isZipping, startLevel]);

  return (
    <div className="min-h-screen bg-brand-cream text-brand-dark font-sans selection:bg-brand-pink selection:text-brand-dark">
      {/* --- Retro Rayo Header --- */}
      <header className="bg-brand-cream/80 backdrop-blur-md border-b-2 border-brand-red/10 px-8 py-5 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="bg-brand-red p-2.5 rounded-2xl shadow-lg rotate-3">
            <Package className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="font-serif font-black text-3xl tracking-tighter text-brand-red leading-none italic">
              素材打包器
            </h1>
            <p className="text-[10px] text-brand-dark/40 font-black tracking-[0.2em] uppercase mt-1">工业级关卡打包套件</p>
          </div>
        </div>
        
        <div className="flex bg-white/50 p-1.5 rounded-full border-2 border-brand-red/5">
          {[
            { id: 'upload' as const, label: '上传导入', icon: FolderOpen },
            { id: 'categorization' as const, label: '品类关联', icon: LayoutGrid },
            { id: 'properties' as const, label: '属性定义', icon: Sliders },
            { id: 'pack' as const, label: '方案生成', icon: Download },
            { id: 'sequence' as const, label: '预览核对', icon: Eye }
          ].map((tab) => (
            <button 
              key={tab.id} 
              onClick={() => setActiveTab(tab.id)}
              disabled={tab.id === 'sequence' && plan.length === 0}
              className={`px-6 py-2.5 rounded-full text-[11px] font-black uppercase tracking-wider transition-all flex items-center gap-2 group ${
                activeTab === tab.id 
                  ? 'bg-brand-red text-white shadow-xl -translate-y-0.5' 
                  : 'text-brand-dark/40 hover:text-brand-red'
              } ${tab.id === 'sequence' && plan.length === 0 ? 'opacity-20 cursor-not-allowed' : ''}`}
            >
              <tab.icon className={`w-3.5 h-3.5 ${activeTab === tab.id ? 'text-white' : 'text-brand-red/40 group-hover:text-brand-red'}`} /> 
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-8">
        <AnimatePresence mode="wait">
          {activeTab === 'sequence' && (
            <motion.div key="sequence" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-10 pb-32">
               <div className="flex justify-between items-center bg-white p-10 rounded-[3rem] border-4 border-brand-red shadow-[10px_10px_0px_#C84737]">
                  <div>
                    <h2 className="text-4xl font-serif font-black italic tracking-tight text-brand-dark uppercase mb-2">关卡序列编排</h2>
                    <p className="text-brand-red text-[10px] font-black uppercase tracking-[0.3em] flex items-center gap-3">
                      <span className="w-2 h-2 rounded-full bg-brand-red animate-pulse"></span>
                      手动排列模式已激活 • 已选中: {selectedIds.length}/2
                    </p>
                  </div>
                  <div className="flex gap-4">
                    <button 
                      onClick={() => {
                        const newPlan = plan.map((p, idx) => ({ ...p, piece_size: ([4, 4, 6] as number[])[idx % 3] }));
                        setPlan(reindexPlan(newPlan));
                      }}
                      className="px-8 py-4 rounded-2xl font-black text-brand-red border-4 border-brand-red hover:bg-brand-red hover:text-white text-[10px] uppercase transition-all"
                    >
                      重置 4-4-6 循环同步
                    </button>
                    <button onClick={() => setActiveTab('pack')} className="bg-brand-red text-white px-12 py-4 rounded-2xl font-black text-[11px] uppercase flex items-center gap-4 hover:scale-105 active:scale-95 transition-all shadow-xl">
                      前往导出页面 <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
               </div>

               <Reorder.Group axis="y" values={plan} onReorder={onPlanOrderChange} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                 {plan.map((item) => {
                   const isSelected = selectedIds.includes(item.id);
                   return (
                     <Reorder.Item 
                       key={item.id} 
                       value={item}
                       className={`bg-white border-4 rounded-[3rem] p-6 transition-all group relative cursor-pointer ${
                         isSelected ? 'border-brand-pink shadow-[0_0_40px_rgba(253,184,193,0.5)] scale-105 z-10' : 'border-brand-red/10 hover:border-brand-red/30'
                       }`}
                       onClick={() => toggleSelect(item.id)}
                     >
                       <div className="aspect-square rounded-[2rem] bg-brand-cream mb-6 overflow-hidden border-2 border-brand-red/5 relative">
                          <img src={item.asset.previewUrl} alt="" className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-700" />
                          <div className="absolute top-4 right-4 bg-brand-red text-white px-3 py-1 rounded-xl text-[10px] font-black italic">
                            {item.piece_size}X{item.piece_size}
                          </div>
                          <div className="absolute bottom-3 left-3 flex flex-col gap-1 items-start">
                             <div className="bg-brand-yellow text-brand-dark px-3 py-1 rounded-xl text-xs font-black italic shadow-md">
                                LV.{item.level_no}
                             </div>
                             {item.violations && item.violations.length > 0 && (
                               <div className="flex flex-wrap gap-1 max-w-[120px]">
                                 {item.violations.includes('SIZE_CYCLE') && <span title="尺寸不匹配 4-4-6 循环" className="bg-red-500 text-white text-[7px] px-1.5 py-0.5 rounded-md font-black uppercase tracking-tighter shadow-sm border border-white/20">尺寸冲突</span>}
                                 {item.violations.includes('CATEGORY_GAP') && <span title="品类出现过于频繁" className="bg-orange-500 text-white text-[7px] px-1.5 py-0.5 rounded-md font-black uppercase tracking-tighter shadow-sm border border-white/20">品类冲突</span>}
                                 {item.violations.includes('DIFFICULTY') && <span title="难度偏离设定序列" className="bg-blue-500 text-white text-[7px] px-1.5 py-0.5 rounded-md font-black uppercase tracking-tighter shadow-sm border border-white/20">难度冲突</span>}
                                 {item.violations.includes('SATURATION') && <span title="饱和度未达标" className="bg-pink-500 text-white text-[7px] px-1.5 py-0.5 rounded-md font-black uppercase tracking-tighter shadow-sm border border-white/20">饱和冲突</span>}
                               </div>
                             )}
                          </div>
                       </div>
                       
                       <div className="space-y-4">
                          <div className="flex justify-between items-center bg-brand-cream/50 p-2 rounded-2xl">
                            <div className="flex flex-col pl-2">
                              <span className="text-[8px] font-black text-brand-dark/30 uppercase tracking-widest">品类/标签</span>
                              <span className="text-xs font-black text-brand-red italic truncate max-w-[100px]">{item.asset.category || '未分类'}</span>
                            </div>
                            <div className="flex gap-1">
                               {[4, 6].map(s => (
                                 <button 
                                   key={s}
                                   onClick={(e) => {
                                     e.stopPropagation();
                                     setPlan(prev => reindexPlan(prev.map(p => p.id === item.id ? { ...p, piece_size: s } : p)));
                                   }}
                                   className={`text-[9px] px-3 py-2 rounded-xl font-black border-2 transition-all ${
                                     item.piece_size === s 
                                     ? 'bg-brand-red text-white border-brand-red shadow-lg scale-110' 
                                     : 'bg-white text-brand-dark/40 border-brand-red/10 hover:border-brand-red/30'
                                   }`}
                                 >
                                   {s}
                                 </button>
                               ))}
                            </div>
                          </div>
                          <div className="text-[9px] font-mono text-brand-dark/30 truncate text-center group-hover:text-brand-dark/60 transition-colors">
                            ID: {item.pic_id}
                          </div>
                       </div>
                     </Reorder.Item>
                   );
                 })}
               </Reorder.Group>
            </motion.div>
          )}
          {activeTab === 'upload' && (
            <motion.div key="upload" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Folder Upload */}
                <div className="bg-white border-4 border-dashed border-brand-red/20 rounded-[3rem] p-10 flex flex-col items-center justify-center gap-6 hover:border-brand-red transition-all group relative cursor-pointer shadow-sm overflow-hidden">
                  <input 
                    type="file" 
                    multiple 
                    // @ts-ignore
                    webkitdirectory="" 
                    onChange={(e) => onFolderSelected(e.target.files)} 
                    className="absolute inset-0 opacity-0 cursor-pointer z-20" 
                  />
                  <div className="w-20 h-20 bg-brand-red rounded-[2rem] flex items-center justify-center group-hover:scale-110 -rotate-3 transition-transform shadow-xl relative z-10">
                    <FolderOpen className="w-8 h-8 text-white" />
                  </div>
                  <div className="text-center relative z-10 space-y-1">
                    <h3 className="font-serif font-black text-2xl tracking-tight italic">文件夹导入</h3>
                    <p className="text-brand-dark/40 font-black text-[9px] uppercase tracking-widest">支持多级目录批量导入</p>
                  </div>
                </div>

                {/* File Upload */}
                <div className="bg-white border-4 border-dashed border-brand-red/20 rounded-[3rem] p-10 flex flex-col items-center justify-center gap-6 hover:border-brand-red transition-all group relative cursor-pointer shadow-sm overflow-hidden">
                  <input 
                    type="file" 
                    multiple 
                    accept=".png"
                    onChange={(e) => onFolderSelected(e.target.files)} 
                    className="absolute inset-0 opacity-0 cursor-pointer z-20" 
                  />
                  <div className="w-20 h-20 bg-brand-pink rounded-[2rem] flex items-center justify-center group-hover:scale-110 rotate-3 transition-transform shadow-xl relative z-10">
                    <Upload className="w-8 h-8 text-brand-dark" />
                  </div>
                  <div className="text-center relative z-10 space-y-1">
                    <h3 className="font-serif font-black text-2xl tracking-tight italic">单文件上传</h3>
                    <p className="text-brand-dark/40 font-black text-[9px] uppercase tracking-widest">支持多选 PNG 格式图片</p>
                  </div>
                </div>
              </div>

              {/* Real-time Pool Statistics Card */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                 {[4, 6].map(size => (
                   <div key={size} className="bg-white p-8 rounded-[3rem] border-4 border-brand-red/5 flex items-center justify-between shadow-sm group hover:border-brand-red/20 transition-all">
                      <div className="space-y-2">
                        <div className="text-[10px] font-black text-brand-dark/30 uppercase tracking-[0.3em]">Matrix {size}x{size} Units</div>
                        <div className="text-4xl font-black italic text-brand-red leading-none">
                          {poolStats[size as 4|6]} 
                        </div>
                        <span className="text-[10px] font-black text-brand-dark/40 uppercase tracking-widest">Available Assets</span>
                      </div>
                      <div className={`p-5 rounded-[2rem] shadow-inner transition-all ${poolStats[size as 4|6] > 0 ? 'bg-brand-blue/20 text-brand-blue border-2 border-brand-blue/30' : 'bg-brand-dark/5 text-brand-dark/10'}`}>
                        <ImageIcon className="w-8 h-8" />
                      </div>
                   </div>
                 ))}
              </div>

              <div className="bg-brand-red text-white p-12 rounded-[4rem] shadow-2xl flex flex-col lg:flex-row items-center justify-between relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-white/10 blur-[100px] rounded-full"></div>
                
                <div className="space-y-6 relative z-10 text-center lg:text-left mb-8 lg:mb-0">
                  <div className="space-y-1">
                    <div className="text-brand-yellow text-[10px] font-black uppercase tracking-[0.4em]">编排就绪 · 待处理流程</div>
                    <h2 className="text-5xl font-serif font-black italic uppercase tracking-tight">素材采集矩阵</h2>
                  </div>
                  
                  <div className="flex flex-wrap gap-6 justify-center lg:justify-start">
                    <div className="bg-white/10 backdrop-blur-2xl px-8 py-5 rounded-[2rem] border border-white/20">
                      <div className="text-[9px] font-bold text-white/50 uppercase tracking-widest mb-1 font-mono">已注册单元</div>
                      <div className="text-4xl font-black italic tracking-tighter">{assets.length} <span className="text-xs ml-1 opacity-50">UNIT</span></div>
                    </div>
                  </div>
                  
                  <p className="text-white/60 text-xs max-w-xl leading-relaxed italic border-l-4 border-brand-yellow pl-5">
                    安全协议已激活：已开启严格查重机制与原子完整性校验，确保导出数据零冗余。
                  </p>
                </div>

                <button 
                  onClick={() => setActiveTab('categorization')} 
                  disabled={assets.length === 0}
                  className={`px-12 py-8 rounded-[2.5rem] font-serif font-black text-xl uppercase tracking-wider italic transition-all shadow-2xl relative z-10 ${
                    assets.length === 0 ? 'bg-white/10 text-white/20 cursor-not-allowed' : 'bg-white text-brand-red hover:bg-brand-yellow hover:text-brand-dark hover:scale-105 active:scale-95'
                  }`}
                >
                   建立品类关联
                </button>
              </div>

              {pendingBatches.length > 0 && (
                <div className="space-y-6">
                  <div className="flex justify-between items-end">
                    <div className="space-y-1">
                      <h3 className="text-2xl font-black italic uppercase tracking-tighter">待导入批次 (Pending Batches)</h3>
                      <p className="text-gray-400 text-[10px] font-bold uppercase tracking-widest">请指定每个文件夹需要提取的图片数量</p>
                    </div>
                    <button 
                      onClick={importAllBatches}
                      className="bg-[#1A1A1A] text-white px-8 py-3 rounded-2xl font-bold text-sm hover:scale-105 transition-transform flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" /> 全部随机导入
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {pendingBatches.map(batch => (
                      <div key={batch.id} className="bg-white p-6 rounded-[2rem] border border-gray-200 flex flex-col gap-6 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-3">
                            <div className="p-3 bg-gray-100 rounded-2xl">
                              <FolderOpen className="w-6 h-6 text-gray-500" />
                            </div>
                            <div>
                              <div className="text-lg font-black uppercase truncate max-w-[200px]">{batch.folderName}</div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] font-bold text-gray-400">检测到 {batch.count} 张图片</span>
                                {batch.metaCount !== undefined && batch.metaCount > 0 && (
                                  <span className="flex items-center gap-1 text-[9px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded-full font-black">
                                    <CheckCircle2 className="w-2 h-2" />
                                    匹配到 {batch.metaCount} 个 JSON 元数据
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <button onClick={() => removeBatch(batch.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>

                        <div className="space-y-3">
                          <div className="flex justify-between items-center text-xs font-bold uppercase tracking-widest">
                            <span className="text-gray-400">导入数量:</span>
                            <span className="text-[#F27D26]">{batch.limit} / {batch.count}</span>
                          </div>
                          <input 
                             type="range" 
                             min="1" 
                             max={batch.count} 
                             value={batch.limit} 
                             onChange={(e) => updateBatchLimit(batch.id, parseInt(e.target.value))}
                             className="w-full h-1.5 bg-gray-100 rounded-full accent-[#F27D26]"
                          />
                        </div>

                        <button 
                          onClick={() => confirmImport(batch)}
                          className="w-full py-4 bg-gray-50 hover:bg-[#1A1A1A] hover:text-white rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2"
                        >
                          确认该批次
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'categorization' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pb-32">
              {/* Left Column: Intelligence & Mapping */}
              <div className="lg:col-span-4 space-y-6">
                <div className="bg-white p-8 rounded-[3rem] border-4 border-brand-red/5 shadow-sm">
                  <h2 className="text-xl font-serif font-black mb-6 flex items-center justify-between text-brand-red italic uppercase tracking-tight">
                    <div className="flex items-center gap-3">
                      <Sliders className="w-6 h-6 text-brand-red" />
                      映射配置中心
                    </div>
                    <div className="flex items-center gap-2 bg-brand-red/5 p-1 rounded-xl border border-brand-red/10">
                       <button 
                         onClick={() => setLabelDisplayLimit(prev => Math.max(1, prev - 1))}
                         className="w-6 h-6 rounded-lg bg-brand-red text-white flex items-center justify-center font-black text-xs hover:scale-110 active:scale-95 transition-all shadow-md"
                       >-</button>
                       <span className="text-xs font-black text-brand-red px-2">{labelDisplayLimit}</span>
                       <button 
                         onClick={() => setLabelDisplayLimit(prev => Math.min(100, prev + 1))}
                         className="w-6 h-6 rounded-lg bg-brand-red text-white flex items-center justify-center font-black text-xs hover:scale-110 active:scale-95 transition-all shadow-md"
                       >+</button>
                    </div>
                  </h2>
                  <p className="text-brand-dark/40 text-[10px] mb-8 font-black uppercase tracking-wider leading-relaxed">
                    定义小标签与大品类之间的关联逻辑。当前展示前 <span className="text-brand-red">{labelDisplayLimit}</span> 个核心标签。
                  </p>

                  <div className="space-y-4">
                    {/* Add Custom Label */}
                    <div className="flex gap-2 mb-4">
                      <input 
                        type="text" 
                        placeholder="添加自定义小标签..."
                        id="customTagMapInput"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const val = (e.target as HTMLInputElement).value.trim();
                            if (val) {
                              setTagToMajorMap(prev => ({ ...prev, [val]: prev[val] || '' }));
                              (e.target as HTMLInputElement).value = '';
                            }
                          }
                        }}
                        className="flex-1 bg-brand-cream/30 border-2 border-brand-red/5 rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest focus:border-brand-red outline-none"
                      />
                      <button 
                        onClick={() => {
                          const input = document.getElementById('customTagMapInput') as HTMLInputElement;
                          const val = input.value.trim();
                          if (val) {
                            setTagToMajorMap(prev => ({ ...prev, [val]: prev[val] || '' }));
                            input.value = '';
                          }
                        }}
                        className="bg-brand-red text-white px-4 rounded-xl hover:scale-105 active:scale-95 transition-all"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    {[...new Set([...recommendedSubCats.slice(0, labelDisplayLimit), ...Object.keys(tagToMajorMap).filter(k => !INITIAL_TAG_MAP[k])])].map((tag, idx) => (
                      <div key={`tag-mapping-${tag}-${idx}`} className="flex items-center justify-between p-4 bg-brand-cream/50 rounded-2xl border-2 border-brand-red/5 hover:border-brand-red/30 transition-all">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                             <span className="text-xs font-black text-brand-dark italic uppercase">{tag}</span>
                             {tagToMajorMap[tag] !== undefined && !INITIAL_TAG_MAP[tag] && (
                               <button 
                                 onClick={() => {
                                   const newMap = { ...tagToMajorMap };
                                   delete newMap[tag];
                                   setTagToMajorMap(newMap);
                                 }}
                                 className="text-brand-red/40 hover:text-brand-red"
                               >
                                 <X className="w-3 h-3" />
                               </button>
                             )}
                          </div>
                          <span className="text-[10px] text-brand-red font-black uppercase tracking-tighter mt-1 opacity-60">
                            → {tagToMajorMap[tag] || '待定义'}
                          </span>
                        </div>
                        <select 
                          value={tagToMajorMap[tag] || ''} 
                          onChange={(e) => setTagToMajorMap(prev => ({ ...prev, [tag]: e.target.value }))}
                          className="bg-white text-[10px] font-black py-2 px-3 rounded-xl border-2 border-brand-red/5 outline-none focus:border-brand-red uppercase"
                        >
                          <option value="">选择大类</option>
                          {Object.keys(CATEGORY_MAP).map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Column: Work Area */}
              <div className="lg:col-span-8 space-y-6">
                <div className="bg-brand-red p-10 rounded-[4rem] text-white shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 blur-[80px] rounded-full"></div>
                  <div className="relative z-10">
                    <div className="flex justify-between items-center mb-8">
                      <div>
                        <h2 className="text-3xl font-serif font-black mb-1 flex items-center gap-4 italic tracking-tight uppercase">
                          <PieChart className="w-8 h-8 text-brand-yellow" />
                          标签策略引擎
                        </h2>
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-brand-yellow animate-pulse"></div>
                          <p className="text-white/60 text-[11px] font-black uppercase tracking-widest italic">{assets.filter(a => a.hasAutoMeta).length} 个匹配项已确认</p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-2">
                      {recommendedSubCats.map(tag => (
                        <button 
                          key={tag}
                          onClick={() => {
                            if (selectedAssetIdsForTagging.length === 0) {
                              alert('请先选择需要操作的素材');
                              return;
                            }
                            const major = tagToMajorMap[tag] || '其他';
                            setAssets(prev => prev.map(a => 
                              selectedAssetIdsForTagging.includes(a.id) 
                                ? { ...a, subCategory: tag, category: major } 
                                : a
                            ));
                          }}
                          className="px-5 py-3 bg-white/10 hover:bg-brand-yellow hover:text-brand-dark border-2 border-white/5 rounded-2xl text-[10px] font-black transition-all flex items-center gap-2 group italic uppercase"
                        >
                          <Plus className="w-3 h-3 opacity-50" />
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

              </div>

              <div className="lg:col-span-12 space-y-10 mt-10">
                {/* Expanded Asset Check Matrix */}
                <div className="bg-white p-10 rounded-[3rem] border-2 border-brand-red/5 shadow-sm overflow-hidden">
                  <div className="flex justify-between items-center mb-10 border-b-2 border-brand-red/5 pb-8">
                    <div>
                      <h3 className="font-serif font-black text-3xl italic text-brand-red uppercase tracking-tight flex items-center gap-4">
                        素材库核对矩阵
                        <span className="text-[10px] font-black bg-brand-red text-white px-3 py-1 rounded-full not-italic tracking-widest">{assets.length} UNITS</span>
                      </h3>
                      <div className="flex flex-wrap gap-x-4 gap-y-2 mt-2">
                        {Object.keys(CATEGORY_MAP).map(cat => {
                          const count = assets.filter(a => a.category === cat).length;
                          if (count === 0) return null;
                          return (
                            <div key={cat} className="flex items-center gap-1.5 bg-brand-red/5 px-2 py-0.5 rounded-lg border border-brand-red/10">
                              <span className="text-[8px] font-black text-brand-red uppercase tracking-tighter">{cat}</span>
                              <span className="text-[9px] font-serif font-black italic text-brand-red/40">{count}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex gap-4">
                       <button 
                         onClick={() => setSelectedAssetIdsForTagging(assets.map(a => a.id))}
                         className="px-8 py-3 rounded-2xl text-[11px] font-black uppercase text-brand-red border-2 border-brand-red/10 hover:bg-brand-red hover:text-white transition-all italic shadow-sm"
                       >
                         全选 (SELECT ALL)
                       </button>
                       <button 
                         onClick={() => setSelectedAssetIdsForTagging([])}
                         className="px-8 py-3 rounded-2xl text-[11px] font-black uppercase text-brand-dark/20 border-2 border-brand-dark/5 hover:bg-brand-dark hover:text-white transition-all italic shadow-sm"
                       >
                         清空 (CLEAR)
                       </button>
                    </div>
                  </div>

                  <div className="overflow-y-auto max-h-[850px] custom-scrollbar">
                    <table className="w-full text-left border-separate border-spacing-y-4">
                       <thead>
                          <tr className="text-[10px] font-black text-brand-dark/20 uppercase tracking-[0.3em]">
                             <th className="pb-6 px-4 font-serif italic text-brand-red w-[220px]">预览预览</th>
                             <th className="pb-6 px-4">标识 (UID/文件名)</th>
                             <th className="pb-6 px-4 text-center">尺寸</th>
                             <th className="pb-6 px-4">自动识别状态</th>
                             <th className="pb-6 px-4">关联大类</th>
                             <th className="pb-6 px-4">画风/子类识别</th>
                             <th className="pb-6 px-4 text-right">管理</th>
                          </tr>
                       </thead>
                       <tbody className="text-xs">
                          {assets.map(a => {
                            const isSelected = selectedAssetIdsForTagging.includes(a.id);
                            return (
                               <tr 
                                 key={a.id} 
                                 onClick={() => {
                                   setSelectedAssetIdsForTagging(prev => 
                                     prev.includes(a.id) ? prev.filter(i => i !== a.id) : [...prev, a.id]
                                   );
                                 }}
                                 onContextMenu={(e) => {
                                   e.preventDefault();
                                   setContextMenu({ x: e.clientX, y: e.clientY, assetId: a.id });
                                 }}
                                 className={`group transition-all cursor-pointer ${
                                   isSelected ? 'opacity-100' : 'opacity-80 hover:opacity-100'
                                 }`}
                               >
                                  <td className="py-6 px-4">
                                     <div className={`w-64 h-64 rounded-[3rem] overflow-hidden border-2 transition-all p-4 flex items-center justify-center bg-white relative group/img ${
                                       isSelected ? 'border-brand-red shadow-2xl scale-105 z-10' : 'border-brand-red/5 group-hover:border-brand-red/20'
                                     }`}>
                                        <img src={a.previewUrl} className="max-w-full max-h-full object-contain group-hover/img:scale-110 transition-transform duration-700 rounded-2xl" alt="" />
                                        
                                        {/* Overlay Tags on Image for better space efficiency */}
                                        <div className="absolute top-4 left-4 flex flex-col gap-2">
                                          <div className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg ${
                                            a.category === '其他' ? 'bg-white/90 text-brand-dark/40' : 'bg-brand-red text-white'
                                          }`}>
                                            {a.category}
                                          </div>
                                          {a.subCategory && (
                                            <div className="bg-brand-yellow text-brand-dark px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg">
                                              {a.subCategory}
                                            </div>
                                          )}
                                        </div>

                                        <div className="absolute bottom-4 right-4 bg-brand-dark/80 backdrop-blur-md text-white px-4 py-1.5 rounded-xl text-[10px] font-black italic shadow-lg">
                                          {a.difficulty || '普通'}
                                        </div>
                                     </div>
                                  </td>
                                  <td className="py-6 px-4">
                                    <div className="flex flex-col gap-3">
                                      <div className="font-mono text-[14px] text-brand-dark font-black uppercase truncate max-w-[250px]">{a.name}</div>
                                      <div className="text-[10px] text-brand-dark/30 font-black truncate max-w-[250px]">{a.fullPath}</div>
                                      <div className="flex items-center gap-2 mt-2">
                                        <div className="w-2 h-2 rounded-full bg-brand-red animate-pulse"></div>
                                        <span className="text-[10px] font-black text-brand-red uppercase tracking-widest italic">{a.saturation}饱和度</span>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-6 px-4 text-center">
                                    <span className="font-black text-brand-red italic text-2xl px-6 py-3 bg-brand-red/5 rounded-3xl border-2 border-brand-red/10">{a.pieceSize}X</span>
                                  </td>
                                  <td className="py-6 px-4">
                                     {a.hasAutoMeta ? (
                                       <div className="flex flex-col gap-2">
                                          <span className="inline-flex items-center gap-2 text-[10px] text-brand-blue font-black uppercase italic">
                                            <CheckCircle2 className="w-4 h-4" />
                                            元数据匹配成功
                                          </span>
                                          <div className="flex flex-wrap gap-1.5 max-w-[200px]">
                                            {a.tags?.map((t: string) => (
                                              <span key={t} className="text-[8px] text-brand-blue/60 bg-brand-blue/5 px-2 py-1 rounded-lg font-black uppercase border border-brand-blue/10">{t}</span>
                                            ))}
                                          </div>
                                       </div>
                                     ) : (
                                       <span className="inline-flex items-center gap-2 text-[10px] bg-brand-dark/5 text-brand-dark/30 px-5 py-3 rounded-[1.5rem] font-black uppercase italic border-2 border-dashed border-brand-dark/10">
                                          <AlertCircle className="w-4 h-4" />
                                          路径启发式识别
                                       </span>
                                     )}
                                  </td>
                                  <td className="py-6 px-4 text-right">
                                     <button 
                                       onClick={(e) => {
                                         e.stopPropagation();
                                         setAssets(prev => prev.filter(item => item.id !== a.id));
                                       }}
                                       className="p-6 text-brand-dark/10 hover:text-brand-red hover:bg-brand-red/5 hover:border-brand-red/20 border-2 border-transparent rounded-[2rem] transition-all"
                                     >
                                        <Trash2 className="w-8 h-8" />
                                     </button>
                                  </td>
                               </tr>
                            );
                          })}
                       </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Bottom Sticky Bar */}
              <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-[90%] max-w-4xl bg-brand-dark p-6 rounded-[3rem] text-white flex justify-between items-center shadow-[0_20px_50px_rgba(0,0,0,0.4)] z-40">
                  <div className="flex items-center gap-8">
                     <div className="space-y-1">
                        <div className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em]">Map Completion</div>
                        <div className="flex items-center gap-3">
                           <div className="w-40 h-3 bg-white/10 rounded-full overflow-hidden border border-white/5">
                              <div className="h-full bg-brand-pink" style={{ width: `${(assets.filter(a => a.category).length / assets.length * 100) || 0}%` }}></div>
                           </div>
                           <span className="text-[10px] font-black italic text-brand-pink">{assets.filter(a => a.category).length} / {assets.length}</span>
                        </div>
                     </div>
                  </div>
                  
                  <div className="flex gap-4">
                    <button 
                      onClick={() => setActiveTab('properties')}
                      className="bg-brand-red text-white px-10 py-3.5 rounded-[2rem] font-black uppercase text-xs tracking-widest hover:bg-brand-yellow hover:text-brand-dark hover:scale-105 transition-all flex items-center gap-3 shadow-xl italic"
                    >
                      PROPERTIES <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
              </div>
            </div>
          )}

          {/* Context Menu */}
          {contextMenu.assetId && (
            <div 
              className="fixed z-50 bg-white border-4 border-brand-dark shadow-[8px_8px_0px_#1A1A1A] py-4 w-64 overflow-hidden"
              style={{ top: contextMenu.y, left: contextMenu.x }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-2 border-b-2 border-brand-dark/5 mb-2">
                <span className="text-[10px] font-black text-brand-red uppercase tracking-widest italic">更改属性 (MODIFY PROPS)</span>
              </div>
              
              <div className="max-h-96 overflow-y-auto custom-scrollbar">
                {/* Major Categories */}
                <div className="px-5 py-2 text-[8px] font-black text-brand-dark/30 uppercase tracking-widest">大品类 (MAJOR)</div>
                {Object.keys(CATEGORY_MAP).map(cat => (
                  <button
                    key={cat}
                    onClick={() => {
                      updateAssetProps(contextMenu.assetId!, { category: cat });
                      setContextMenu({ x: 0, y: 0, assetId: null });
                    }}
                    className="w-full text-left px-5 py-2 hover:bg-brand-red hover:text-white text-[11px] font-black transition-colors flex items-center justify-between group"
                  >
                    <span>{cat}</span>
                    <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}

                <div className="h-px bg-brand-dark/5 my-3 shadow-sm"></div>

                {/* Sub Categories / Styles synchronized with mapping center */}
                <div className="px-5 py-2 text-[8px] font-black text-brand-dark/30 uppercase tracking-widest">同步自映射中心 (MAPPED STYLES)</div>
                {[...new Set([...recommendedSubCats.slice(0, labelDisplayLimit), ...Object.keys(tagToMajorMap).filter(k => !INITIAL_TAG_MAP[k])])].map((style, idx) => (
                  <button
                    key={`ctx-style-${style}-${idx}`}
                    onClick={() => {
                      updateAssetProps(contextMenu.assetId!, { subCategory: style });
                      setContextMenu({ x: 0, y: 0, assetId: null });
                    }}
                    className="w-full text-left px-5 py-2 hover:bg-brand-yellow hover:text-brand-dark text-[11px] font-black transition-colors flex items-center justify-between group"
                  >
                    <span>{style}</span>
                    <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}

                <div className="h-px bg-brand-dark/5 my-3"></div>

                <div className="px-5 py-2">
                  <input 
                    type="text"
                    placeholder="输入自定义画风..."
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value.trim();
                        if (val) {
                          updateAssetProps(contextMenu.assetId!, { subCategory: val });
                          setContextMenu({ x: 0, y: 0, assetId: null });
                        }
                      }
                    }}
                    className="w-full bg-brand-cream/30 border-2 border-brand-red/5 rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest focus:border-brand-red outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'properties' && (
            <div className="space-y-8 pb-32">
              <div className="flex justify-between items-end bg-white p-10 rounded-[3.5rem] border-4 border-brand-red/5 shadow-sm">
                <div className="space-y-1">
                  <h2 className="text-3xl font-serif font-black italic tracking-tight uppercase text-brand-red">资产属性定义 (Nuance)</h2>
                  <p className="text-brand-dark/40 text-[10px] font-black uppercase tracking-wider italic">
                    定义饱和度与难度评级系数，用于高级关卡平衡算法分配。
                  </p>
                </div>
                <div className="flex gap-3">
                   <button 
                     onClick={() => {
                        const ids = assets.filter(a => a.category).map(a => a.id);
                        setSelectedAssetIdsForTagging(ids);
                     }}
                     className="px-6 py-3 bg-brand-cream border-2 border-brand-red/5 rounded-2xl text-[10px] font-black uppercase hover:bg-brand-red hover:text-white transition-all shadow-sm italic"
                   >
                     选中已分类素材
                   </button>
                   <button 
                     onClick={() => setSelectedAssetIdsForTagging([])}
                     className="px-6 py-3 bg-brand-cream border-2 border-brand-red/5 rounded-2xl text-[10px] font-black uppercase hover:bg-brand-red hover:text-white transition-all shadow-sm italic"
                   >
                     取消选中
                   </button>
                </div>
              </div>

              <div className="grid grid-cols-12 gap-8">
                 {/* Left: Selection Pool */}
                 <div className="col-span-8 bg-white rounded-[3.5rem] border-4 border-brand-red/5 shadow-sm p-8 max-h-[700px] overflow-y-auto custom-scrollbar">
                    <div className="grid grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 content-start">
                       {assets.map(asset => (
                         <div 
                           key={asset.id} 
                           onClick={() => setSelectedAssetIdsForTagging(prev => 
                             prev.includes(asset.id) ? prev.filter(i => i !== asset.id) : [...prev, asset.id]
                           )}
                           className={`aspect-square rounded-3xl overflow-hidden border-2 p-1 cursor-pointer transition-all relative ${
                             selectedAssetIdsForTagging.includes(asset.id) 
                               ? 'border-brand-red ring-4 ring-brand-red/10' 
                               : 'border-brand-red/5 hover:border-brand-red/20'
                           }`}
                         >
                           <img src={asset.previewUrl} className="w-full h-full object-contain rounded-2xl" alt="" />
                           {!asset.category && <div className="absolute top-2 left-2 bg-brand-red text-white p-1 rounded-full shadow-lg"><AlertCircle className="w-3 h-3" /></div>}
                           <div className="absolute top-2 right-2 flex flex-col gap-1">
                              {asset.saturation && (
                                <span className="bg-brand-dark text-white text-[8px] px-2 py-0.5 rounded-lg font-black uppercase shadow-md">{asset.saturation}</span>
                              )}
                              {asset.difficulty && (
                                <span className="bg-brand-blue text-white text-[8px] px-2 py-0.5 rounded-lg font-black uppercase shadow-md">{asset.difficulty}</span>
                              )}
                           </div>
                         </div>
                       ))}
                    </div>
                 </div>

                 {/* Right: Tagging Controller */}
                 <div className="col-span-4 space-y-6">
                    <div className="bg-white rounded-[3.5rem] border-4 border-brand-red shadow-[10px_10px_0px_#C84737] p-10 sticky top-32">
                       <h3 className="text-xl font-serif font-black italic uppercase tracking-tight mb-8 flex items-center justify-between text-brand-red">
                         控制中枢
                         <span className="text-brand-dark/20 text-[10px] font-black">{selectedAssetIdsForTagging.length} 已选中</span>
                       </h3>

                       <div className="space-y-10">
                          {/* Saturation Block */}
                          <div className="space-y-4">
                             <div className="text-[10px] font-black text-brand-dark/40 uppercase tracking-widest flex items-center gap-2">
                                <Search className="w-4 h-4 text-brand-red/20" /> 设置饱和度
                             </div>
                             <div className="grid grid-cols-3 gap-2">
                                {Object.keys(SATURATION_MAP).map(sat => (
                                  <button 
                                    key={sat}
                                    disabled={selectedAssetIdsForTagging.length === 0}
                                    onClick={() => {
                                      setAssets(prev => prev.map(a => selectedAssetIdsForTagging.includes(a.id) ? { ...a, saturation: sat } : a));
                                    }}
                                    className="py-4 bg-brand-cream hover:bg-brand-red hover:text-white rounded-2xl text-[10px] font-black uppercase transition-all disabled:opacity-20 border-2 border-brand-red/5 hover:border-brand-red shadow-sm italic"
                                  >
                                    {sat}
                                  </button>
                                ))}
                             </div>
                          </div>

                          {/* Difficulty Block */}
                          <div className="space-y-4">
                             <div className="text-[10px] font-black text-brand-dark/40 uppercase tracking-widest flex items-center gap-2">
                               <Target className="w-4 h-4 text-brand-red/20" /> 设置难度评级
                             </div>
                             <div className="grid grid-cols-3 gap-2">
                                {Object.keys(DIFFICULTY_MAP).map(diff => (
                                  <button 
                                    key={diff}
                                    disabled={selectedAssetIdsForTagging.length === 0}
                                    onClick={() => {
                                      setAssets(prev => prev.map(a => selectedAssetIdsForTagging.includes(a.id) ? { ...a, difficulty: diff } : a));
                                    }}
                                    className="py-4 bg-brand-cream hover:bg-brand-blue hover:text-white rounded-2xl text-[10px] font-black uppercase transition-all disabled:opacity-20 border-2 border-brand-red/5 hover:border-brand-blue shadow-sm italic"
                                  >
                                    {diff}
                                  </button>
                                ))}
                             </div>
                          </div>

                          <div className="pt-10 border-t-2 border-brand-red/5 flex items-start gap-4 text-[10px] text-brand-dark/40 italic font-black uppercase tracking-tight">
                             <AlertCircle className="w-5 h-5 text-brand-red/40 shrink-0" />
                             属性参数将直接影响导出元数据及关卡权重平衡分配。
                          </div>
                       </div>
                    </div>
                 </div>
              </div>

              {/* Bottom Sticky Bar */}
              <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-[90%] max-w-4xl bg-brand-dark p-6 rounded-[3rem] text-white flex justify-between items-center shadow-[0_20px_50px_rgba(0,0,0,0.4)] z-40">
                  <div className="flex items-center gap-4">
                     <div className="bg-white/5 px-8 py-4 rounded-3xl flex gap-10 border border-white/5">
                        <div className="flex flex-col">
                           <span className="text-[8px] text-white/30 uppercase font-black tracking-widest">饱和度已标记</span>
                           <span className="text-lg font-black italic text-brand-yellow font-serif">{assets.filter(a => a.saturation).length}</span>
                        </div>
                        <div className="flex flex-col">
                           <span className="text-[8px] text-white/30 uppercase font-black tracking-widest">难度评级已标记</span>
                           <span className="text-lg font-black italic text-brand-red font-serif">{assets.filter(a => a.difficulty).length}</span>
                        </div>
                     </div>
                  </div>
                  
                  <div className="flex gap-4">
                     <button 
                      onClick={() => setActiveTab('pack')}
                      className="bg-brand-red text-white px-12 py-4 rounded-[2rem] font-black uppercase text-xs tracking-widest hover:bg-brand-yellow hover:text-brand-dark hover:scale-105 transition-all flex items-center gap-3 shadow-xl italic"
                    >
                      进入最终方案生成阶段 <ArrowRight className="w-5 h-5" />
                    </button>
                  </div>
              </div>
            </div>
          )}

          {activeTab === 'pack' && (
            <motion.div key="pack" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 lg:grid-cols-3 gap-12 py-10 pb-32">
              <div className="lg:col-span-2 space-y-10">
                {/* --- Master Generator Panel --- */}
                <div className="bg-brand-dark p-12 rounded-[4rem] border-4 border-white/5 space-y-12 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.8)] relative overflow-hidden">
                   <div className="absolute top-0 right-0 w-96 h-96 bg-brand-red/20 blur-[100px] rounded-full -translate-y-1/2 translate-x-1/2"></div>
                   <div className="flex justify-between items-start relative z-10">
                      <div>
                        <h2 className="text-5xl font-serif font-black italic text-white uppercase tracking-tight mb-4 flex items-center gap-6">
                          <Sliders className="w-12 h-12 text-brand-red" />
                          引擎核心
                        </h2>
                        <p className="text-white/40 font-black text-[10px] uppercase tracking-[0.4em] mb-8 italic">智能化编排控制系统</p>
                      </div>
                      <div className="bg-white/5 px-8 py-4 rounded-3xl border-2 border-white/10 flex flex-col items-end shadow-xl">
                         <span className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1">打包密度</span>
                         <span className="text-3xl font-serif font-black text-brand-yellow italic">{levelsPerPack} <span className="text-xs not-italic font-sans opacity-40">关卡/包</span></span>
                      </div>
                   </div>

                   <div className="grid grid-cols-1 md:grid-cols-2 gap-10 relative z-10">
                      {[
                        { label: '01. 起始关卡 ID', value: startLevel, setter: setStartLevel, min: 1, max: 9999, suffix: 'NO.' },
                        { label: '02. 批量打包数量', value: batchCount, setter: setBatchCount, min: 1, max: 100, suffix: '包' },
                        { label: '03. 每包关卡密度', value: levelsPerPack, setter: setLevelsPerPack, min: 10, max: 100, suffix: '件' },
                        { label: '04. 品类避让距离', value: categoryGap, setter: setCategoryGap, min: 0, max: 20, suffix: '空隙' },
                        { label: '05. 饱和度避让距离', value: saturationGap, setter: setSaturationGap, min: 0, max: 20, suffix: '空隙' }
                      ].map(field => (
                        <div key={field.label} className="bg-white/5 p-10 rounded-[3rem] border-2 border-white/5 hover:border-brand-red/40 transition-all group cursor-pointer shadow-sm">
                           <div className="flex justify-between items-end mb-8">
                              <label className="text-[10px] font-black uppercase text-white/30 tracking-[0.3em] group-hover:text-white transition-colors italic">{field.label}</label>
                              <div className="text-5xl font-serif font-black italic text-brand-red tracking-tight group-hover:text-brand-yellow transition-colors">
                                {field.value}
                                <span className="text-[10px] font-sans font-black text-white/20 ml-3 not-italic uppercase tracking-widest">{field.suffix}</span>
                              </div>
                           </div>
                           <input 
                              type="range" 
                              min={field.min} 
                              max={field.max} 
                              value={field.value} 
                              onChange={(e) => field.setter(parseInt(e.target.value))}
                              className="w-full h-3 bg-white/5 rounded-full accent-brand-red cursor-pointer appearance-none border border-white/5"
                           />
                        </div>
                      ))}
                   </div>

                   <div className="pt-12 border-t border-white/5 relative z-10 space-y-12">
                      <div className="space-y-8">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="bg-brand-red w-2 h-7 rounded-full shadow-[0_0_15px_rgba(200,71,55,0.5)]"></div>
                            <div className="flex flex-col">
                              <label className="text-[10px] font-black uppercase text-white/40 tracking-[0.4em]">难度阶梯自定义循环序列 (Cycle Sequence)</label>
                              <span className="text-[8px] text-white/20 mt-1 uppercase font-black tracking-widest italic">点击标签可删除 • 点击右侧添加按钮新增难度节点</span>
                            </div>
                          </div>
                          <div className="flex gap-2">
                             {["简单", "普通", "困难"].map(d => (
                               <button 
                                 key={d}
                                 onClick={() => setDifficultySequence(prev => [...prev, d])}
                                 className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-[10px] font-black text-white hover:bg-brand-red transition-all italic"
                               >
                                 + {d}
                               </button>
                             ))}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-4 p-8 bg-white/5 rounded-[3rem] border-2 border-white/5 shadow-inner min-h-[120px] items-center">
                           {difficultySequence.map((d, i) => (
                             <React.Fragment key={i}>
                               <motion.div 
                                 layout
                                 initial={{ scale: 0.8, opacity: 0 }}
                                 animate={{ scale: 1, opacity: 1 }}
                                 className={`px-8 py-4 rounded-[1.5rem] text-xs font-black uppercase tracking-widest shadow-xl cursor-pointer group relative flex items-center gap-3 transition-all ${
                                   d === '困难' ? 'bg-brand-red text-white' : d === '普通' ? 'bg-brand-blue text-white' : 'bg-brand-yellow text-brand-dark'
                                 }`}
                                 onClick={() => setDifficultySequence(prev => prev.filter((_, idx) => idx !== i))}
                               >
                                 <span className="opacity-40 text-[8px] font-mono mr-2">#{i+1}</span>
                                 {d}
                                 <X className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity ml-2" />
                               </motion.div>
                               {i < difficultySequence.length - 1 && (
                                 <ArrowRight className="w-4 h-4 text-white/10" />
                               )}
                             </React.Fragment>
                           ))}
                           {difficultySequence.length === 0 && (
                             <div className="text-white/20 font-serif italic text-sm w-full text-center">序列为空，请从上方添加难度节点...</div>
                           )}
                        </div>
                      </div>
                   </div>
                </div>
              </div>

              {/* Sidebar Actions */}
              <div className="space-y-8">
                <div className="bg-white p-10 rounded-[3.5rem] border-4 border-brand-red/5 shadow-sm">
                  <h2 className="text-2xl font-serif font-black italic text-brand-red uppercase tracking-tight mb-8 flex items-center gap-4 group">
                    <History className="w-6 h-6 text-brand-red group-hover:rotate-180 transition-transform duration-700" />
                    命名规则策略
                  </h2>
                  <Reorder.Group axis="y" values={namingScheme} onReorder={setNamingScheme} className="space-y-3">
                    {namingScheme.map((item) => (
                      <Reorder.Item 
                        key={item.id} 
                        value={item}
                        className={`p-6 rounded-2xl flex items-center justify-between border-2 cursor-grab active:cursor-grabbing transition-all ${
                          item.enabled ? 'bg-brand-cream text-brand-dark border-brand-red shadow-lg italic' : 'bg-brand-cream/30 border-brand-red/5 text-brand-dark/20'
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <GripVertical className="w-4 h-4 opacity-30" />
                          <span className="text-[10px] font-black uppercase tracking-widest">{item.label}</span>
                        </div>
                        <input 
                           type="checkbox" 
                           checked={item.enabled} 
                           onChange={() => setNamingScheme(prev => prev.map(c => c.id === item.id ? { ...c, enabled: !c.enabled } : c))}
                           className="w-5 h-5 rounded-lg border-2 border-brand-red/20 text-brand-red focus:ring-0 checked:bg-brand-red transition-all cursor-pointer"
                        />
                      </Reorder.Item>
                    ))}
                  </Reorder.Group>
                </div>

                <div className="space-y-4">
                  <button 
                    onClick={generatePlan}
                    disabled={isGenerating || assets.length === 0}
                    className="w-full py-12 bg-white hover:bg-brand-red text-brand-dark hover:text-white border-4 border-brand-red rounded-[4rem] transition-all flex flex-col items-center justify-center gap-2 group shadow-[15px_15px_0px_#C84737] hover:scale-105 active:scale-95"
                  >
                    <div className="flex items-center gap-6">
                      {isGenerating ? <RefreshCw className="w-10 h-10 animate-spin" /> : <Layers className="w-10 h-10" />}
                      <span className="font-serif font-black italic text-2xl uppercase tracking-tighter">执行构建计划</span>
                    </div>
                  </button>

                  <button 
                    onClick={exportZip}
                    disabled={plan.length === 0 || isZipping}
                    className="w-full py-10 bg-brand-dark hover:bg-brand-blue text-white font-black text-xl uppercase tracking-widest rounded-[3.5rem] transition-all flex items-center justify-center gap-6 group shadow-2xl disabled:opacity-30 disabled:grayscale italic"
                  >
                    {isZipping ? <RefreshCw className="w-6 h-6 animate-spin" /> : <Download className="w-6 h-6" />}
                    <span>下载成品数据包</span>
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
