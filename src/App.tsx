import { useState, useCallback, useMemo, useRef } from 'react';
import { 
  Upload, 
  Package, 
  FileText, 
  Download, 
  Trash2, 
  Plus, 
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
  Search
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import JSZip from 'jszip';

// --- Constants & Mappings ---

const CATEGORY_MAP: Record<string, string> = {
  "中景静物": "mid_still",
  "特写景物": "close_up",
  "街头风景": "street_scenery",
  "艺术/插画": "art_illustration",
  "动物": "animal",
  "建筑群": "architecture_cluster",
  "建筑前院": "front_yard",
  "室内": "interior",
  "后院": "backyard",
  "自然景观": "natural_scenery",
  "食物": "food",
  "人物": "portrait",
  "海滨": "seaside"
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

interface Asset {
  id: string;
  name: string;
  file: File;
  pieceSize: 4 | 6;
  fullPath: string; 
  previewUrl: string; 
  category?: string;     // 中文品类名
  saturation?: string;   // "高" | "中" | "低"
  difficulty?: string;   // "简单" | "普通" | "困难"
}

interface PendingBatch {
  id: string;
  folderName: string;
  files: File[];
  count: number;
  limit: number;
}

interface LevelPlan {
  id: string; 
  level_no: number;
  pic_id: string;
  piece_size: number;
  difficulty: number;
  source_path: string;
  asset: Asset; 
}

// --- Python Template ---
const generatePythonScript = (planCsvName: string) => `
import os
import csv
import shutil
import json
import sys
from datetime import datetime

# --- Configuration ---
PLAN_CSV = "${planCsvName}"
OUTPUT_ROOT = "Packed_Game_Levels"
BATCH_SIZE = 50

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
  const [activeTab, setActiveTab] = useState<'upload' | 'categorization' | 'properties' | 'sequence' | 'pack'>('upload');
  const [namingScheme, setNamingScheme] = useState([
    { id: 'seq', label: '关卡序列', enabled: true },
    { id: 'cat', label: '品类(EN)', enabled: true },
    { id: 'sat', label: '饱和度', enabled: false },
    { id: 'diff', label: '难度', enabled: false },
    { id: 'name', label: '原文件名', enabled: true },
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [selectedAssetIdsForTagging, setSelectedAssetIdsForTagging] = useState<string[]>([]);
  
  // Ratio / Weight States
  const [satWeights, setSatWeights] = useState<Record<string, number>>({
    "高": 40,
    "中": 40,
    "低": 20
  });

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


  const onFolderSelected = (files: FileList | null) => {
    if (!files) return;
    const allFiles = Array.from(files);
    
    const validFiles = allFiles.filter(file => {
      const name = file.name;
      // Revert to strict PNG support as requested
      const isPNG = file.type === 'image/png' || /\.png$/i.test(name);
      const isNotSystemFile = !name.startsWith('.') && name !== 'Thumbs.db';
      return isPNG && isNotSystemFile;
    });

    if (validFiles.length === 0) {
      alert('所选文件夹中未检测到有效的 PNG 图片。目前仅支持 PNG 格式。');
      return;
    }

    const firstValidFile = validFiles[0];
    const path = (firstValidFile as any).webkitRelativePath;
    const folderName = path ? path.split('/')[0] : "手动选片";
    
    const newBatch: PendingBatch = {
      id: Math.random().toString(36).substr(2, 9),
      folderName,
      files: validFiles,
      count: validFiles.length,
      limit: validFiles.length
    };

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
    
    const newAssets: Asset[] = selectedFiles.map(file => {
      const fileName = file.name;
      const lastDotIndex = fileName.lastIndexOf('.');
      const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
      const fullPath = (file as any).webkitRelativePath || file.name;

      return {
        id: Math.random().toString(36).substr(2, 9),
        name: baseName,
        file,
        fullPath,
        pieceSize: 4, // Default to 4 as auto-detection is removed
        previewUrl: URL.createObjectURL(file),
      };
    });

    setAssets(prev => [...prev, ...newAssets]);
    setPendingBatches(prev => prev.filter(b => b.id !== batch.id));
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
      const requestedTotal = batchCount * 50;
      const validAssetPool = assets.filter(a => a.pieceSize === 4 || a.pieceSize === 6);
      const actualAvailable = validAssetPool.length;
      
      const maxFullBatches = Math.floor(actualAvailable / 50);
      const batchesToActuallyGenerate = Math.min(batchCount, maxFullBatches);
      const levelsToGenerate = batchesToActuallyGenerate * 50;
      
      let levelsCreated = 0;
      let currentLNo = startLevel;

      const usedAssetIds = new Set<string>();

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

      while (levelsCreated < levelsToGenerate) {
        // Enforce strict 4-4-6 cycle as requested: 4 -> 4 -> 6
        const targetSize = ([4, 4, 6] as (4|6)[])[levelsCreated % 3];
        const desiredSat = getDesiredSat();
        
        // Track recent categories to avoid repeats within the gap
        const recentCategories = new Set(
          tempPlan.slice(Math.max(0, tempPlan.length - categoryGap))
            .map(p => p.asset.category)
            .filter(Boolean)
        );

        let selectedAsset: Asset | null = null;

        // Try prioritized selection: matching size AND saturation AND checking category gap
        const bestMatches = assets.filter(a => 
          a.pieceSize === targetSize && 
          (!desiredSat || a.saturation === desiredSat) && 
          !usedAssetIds.has(a.id) &&
          (!a.category || !recentCategories.has(a.category))
        );

        if (bestMatches.length > 0) {
          selectedAsset = bestMatches[Math.floor(Math.random() * bestMatches.length)];
        } else {
          // Relax saturation requirement but still check category gap
          const sizeMatches = assets.filter(a => 
            a.pieceSize === targetSize && 
            !usedAssetIds.has(a.id) &&
            (!a.category || !recentCategories.has(a.category))
          );
          
          if (sizeMatches.length > 0) {
            selectedAsset = sizeMatches[Math.floor(Math.random() * sizeMatches.length)];
          } else {
            // Relax category gap as well
            const forcedMatches = assets.filter(a => 
              a.pieceSize === targetSize && 
              !usedAssetIds.has(a.id)
            );

            if (forcedMatches.length > 0) {
              selectedAsset = forcedMatches[Math.floor(Math.random() * forcedMatches.length)];
            } else {
              // Last resort: Fallback to other allowed size
              const otherSize = targetSize === 4 ? 6 : 4;
              const fallbackMatches = assets.filter(a => a.pieceSize === otherSize && !usedAssetIds.has(a.id));
              if (fallbackMatches.length > 0) {
                selectedAsset = fallbackMatches[Math.floor(Math.random() * fallbackMatches.length)];
              } else {
                break; 
              }
            }
          }
        }

        if (!selectedAsset) break;

        usedAssetIds.add(selectedAsset.id);

        const finalDifficulty = selectedAsset.pieceSize === 6 ? 1 : 0;

        tempPlan.push({
          id: `plan-${currentLNo}-${Math.random().toString(36).substr(2, 5)}`,
          level_no: currentLNo,
          pic_id: buildFileName(currentLNo, selectedAsset.pieceSize, selectedAsset),
          piece_size: selectedAsset.pieceSize,
          difficulty: finalDifficulty,
          source_path: selectedAsset.fullPath,
          asset: selectedAsset
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
  }, [assets, batchCount, startLevel, isGenerating, buildFileName, satWeights, categoryGap]);

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
      zip.file("run_packer.py", generatePythonScript(planName));

      // 3. Generate Statistics Report (Brief)
      const s4 = plan.filter(p => p.piece_size === 4).length;
      const s6 = plan.filter(p => p.piece_size === 6).length;
      let statsMd = "# 关卡导出报告\n\n";
      statsMd += `| 导出范围 | 总关卡 | 4x4 | 6x6 |\n`;
      statsMd += `| :--- | :--- | :--- | :--- |\n`;
      statsMd += `| ${plan[0].level_no} - ${plan[plan.length-1].level_no} | ${plan.length} | ${s4} | ${s6} |\n`;
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
    <div className="min-h-screen bg-[#F0F1F3] text-[#1A1A1A] font-sans">
      {/* Header */}
      <header className="bg-white border-b border-[#D1D5DB] px-8 py-4 flex justify-between items-center sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-[#1A1A1A] p-2 rounded-lg">
            <Package className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-xl tracking-tight uppercase">Local Pack Engine</h1>
            <p className="text-[10px] text-gray-400 font-mono tracking-widest italic flex items-center gap-1">
              <History className="w-3 h-3 text-[#F27D26]" /> V3.0 PRO - 零内存高效率
            </p>
          </div>
        </div>
        <div className="flex gap-2 p-1 bg-gray-100 rounded-xl">
          {[
            { id: 'upload' as const, label: '上传素材', icon: FolderOpen },
            { id: 'categorization' as const, label: '品类分类', icon: LayoutGrid },
            { id: 'properties' as const, label: '属性标记', icon: Sliders },
            { id: 'pack' as const, label: '生成工具', icon: Download },
            { id: 'sequence' as const, label: '预览顺排', icon: Eye }
          ].map((tab) => (
            <button 
              key={tab.id} 
              onClick={() => setActiveTab(tab.id as any)} 
              disabled={tab.id === 'sequence' && plan.length === 0}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                activeTab === tab.id ? 'bg-white text-[#1A1A1A] shadow-sm' : 'text-gray-500 hover:text-gray-800'
              } ${tab.id === 'sequence' && plan.length === 0 ? 'opacity-30 cursor-not-allowed' : ''}`}
            >
              <tab.icon className="w-3 h-3" /> {tab.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-8">
        <AnimatePresence mode="wait">
          {activeTab === 'sequence' && (
            <motion.div key="sequence" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
               <div className="flex justify-between items-end bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm">
                  <div className="space-y-1">
                    <h2 className="text-3xl font-black italic tracking-tighter uppercase">关卡序列校对 (Drag or Swap)</h2>
                    <p className="text-gray-400 text-xs font-bold uppercase tracking-widest font-mono">
                      拖拽卡片可排序 • 依次点击两个卡片可交换位置 (当前已选中 {selectedIds.length}/2)
                    </p>
                  </div>
                  <div className="flex gap-4">
                    <button 
                      onClick={() => {
                        const newPlan = plan.map((p, idx) => ({
                          ...p,
                          piece_size: ([4, 4, 6] as number[])[idx % 3]
                        }));
                        setPlan(reindexPlan(newPlan));
                      }}
                      className="px-6 py-3 rounded-2xl font-bold border border-orange-200 text-[#F27D26] hover:bg-orange-50 text-xs uppercase flex items-center gap-2"
                      title="强制应用 4-4-6 循环序列"
                    >
                      <RefreshCw className="w-3 h-3" /> 重置 4-4-6 循环
                    </button>
                    {selectedIds.length > 0 && (
                      <button onClick={() => setSelectedIds([])} className="px-6 py-3 rounded-2xl font-bold border border-gray-200 text-gray-500 hover:bg-gray-50">
                        取消选中
                      </button>
                    )}
                    <button onClick={() => setActiveTab('pack')} className="bg-[#1A1A1A] text-white px-8 py-3 rounded-2xl font-bold flex items-center gap-2 hover:scale-105 transition-transform shadow-lg">
                      确认序列并去导出 <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
               </div>

               <Reorder.Group 
                 axis="y" 
                 values={plan} 
                 onReorder={onPlanOrderChange} 
                 className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
               >
                 {plan.map((item) => {
                   const isSelected = selectedIds.includes(item.id);
                   return (
                     <Reorder.Item 
                       key={item.id} 
                       value={item}
                       className={`bg-white border rounded-3xl p-4 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-all group relative ${
                         isSelected ? 'ring-4 ring-[#F27D26] bg-orange-50 border-transparent z-10' : 'border-gray-100'
                       }`}
                     >
                       {/* Overlay to catch clicks for selection without interfering with drag handle if needed */}
                       <div 
                         className="absolute inset-0 z-0 rounded-3xl cursor-pointer" 
                         onClick={(e) => {
                           e.stopPropagation();
                           toggleSelect(item.id);
                         }}
                       />
                       
                       <div className="aspect-square rounded-2xl bg-gray-50 mb-3 overflow-hidden border border-gray-100 relative z-1 pointer-events-none">
                          <img 
                            src={item.asset.previewUrl} 
                            alt={item.pic_id} 
                            className="w-full h-full object-contain"
                          />
                          <div className="absolute top-2 right-2 bg-white/90 backdrop-blur px-2 py-1 rounded-lg text-[10px] font-black font-mono shadow-sm">
                            {item.piece_size}x{item.piece_size}
                          </div>
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                             <GripVertical className="text-white w-8 h-8" />
                          </div>
                       </div>
                       
                       <div className="space-y-2 relative z-1 pointer-events-none">
                          <div className="flex justify-between items-center">
                            <span className={`px-2 py-0.5 rounded-lg font-mono text-xs font-black ${isSelected ? 'bg-[#F27D26] text-white' : 'bg-[#1A1A1A] text-white'}`}>
                              LV.{item.level_no}
                            </span>
                            <div className="flex gap-1">
                               {[4, 6].map(s => (
                                 <button 
                                   key={s}
                                   onClick={(e) => {
                                     e.stopPropagation();
                                     setPlan(prev => reindexPlan(prev.map(p => p.id === item.id ? { ...p, piece_size: s } : p)));
                                   }}
                                   className={`text-[8px] px-2 py-0.5 rounded font-black border transition-all ${
                                     item.piece_size === s 
                                     ? 'bg-[#F27D26] text-white border-transparent shadow-sm scale-110' 
                                     : 'bg-white text-gray-400 border-gray-100 hover:text-gray-900 pointer-events-auto cursor-pointer relative z-20'
                                   }`}
                                 >
                                   {s}X{s}
                                 </button>
                               ))}
                            </div>
                          </div>
                          <div className="text-[10px] font-mono text-gray-500 truncate border-t border-gray-50 pt-2" title={item.pic_id}>
                            {item.pic_id}.png
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
                <div className="bg-white border-2 border-dashed border-[#1A1A1A]/20 rounded-[3.5rem] p-12 flex flex-col items-center justify-center gap-6 hover:border-[#1A1A1A] transition-all group relative cursor-pointer shadow-sm hover:shadow-xl overflow-hidden">
                  <input 
                    type="file" 
                    multiple 
                    // @ts-ignore
                    webkitdirectory="" 
                    onChange={(e) => onFolderSelected(e.target.files)} 
                    className="absolute inset-0 opacity-0 cursor-pointer z-20" 
                  />
                  <div className="w-24 h-24 bg-[#1A1A1A] rounded-3xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-lg relative z-10">
                    <FolderOpen className="w-10 h-10 text-white" />
                  </div>
                  <div className="text-center relative z-10 space-y-2">
                    <h3 className="font-black text-2xl uppercase tracking-tighter italic">导入文件夹</h3>
                    <p className="text-gray-400 font-mono text-[10px] uppercase tracking-widest tracking-[0.2em]">UPLOAD WHOLE FOLDERS</p>
                  </div>
                </div>

                {/* File Upload */}
                <div className="bg-white border-2 border-dashed border-[#1A1A1A]/20 rounded-[3.5rem] p-12 flex flex-col items-center justify-center gap-6 hover:border-[#1A1A1A] transition-all group relative cursor-pointer shadow-sm hover:shadow-xl overflow-hidden">
                  <input 
                    type="file" 
                    multiple 
                    accept=".png"
                    onChange={(e) => onFolderSelected(e.target.files)} 
                    className="absolute inset-0 opacity-0 cursor-pointer z-20" 
                  />
                  <div className="w-24 h-24 bg-[#F27D26] rounded-3xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-lg relative z-10">
                    <Upload className="w-10 h-10 text-white" />
                  </div>
                  <div className="text-center relative z-10 space-y-2">
                    <h3 className="font-black text-2xl uppercase tracking-tighter italic">导入多张图片</h3>
                    <p className="text-gray-400 font-mono text-[10px] uppercase tracking-widest tracking-[0.2em]">UPLOAD INDIVIDUAL FILES</p>
                  </div>
                </div>
              </div>

              {/* Real-time Pool Statistics Card */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 {[4, 6].map(size => (
                   <div key={size} className="bg-white p-8 rounded-[2rem] border border-gray-200 flex items-center justify-between shadow-sm">
                      <div className="space-y-1">
                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{size}X{size} Detected</div>
                        <div className="text-3xl font-black font-mono italic">{poolStats[size as 4|6]} <span className="text-sm font-normal text-gray-300">IMAGES</span></div>
                      </div>
                      <div className={`p-4 rounded-2xl ${poolStats[size as 4|6] > 0 ? 'bg-indigo-50 text-indigo-500' : 'bg-gray-50 text-gray-300'}`}>
                        <ImageIcon className="w-6 h-6" />
                      </div>
                   </div>
                 ))}
              </div>

              <div className="bg-[#1A1A1A] text-white p-10 rounded-[3rem] shadow-2xl flex items-center justify-between border border-white/10 relative overflow-hidden">
                <div className="absolute top-[-50px] left-[-50px] w-64 h-64 bg-indigo-600/20 blur-[100px] rounded-full"></div>
                <div className="space-y-4 relative z-10">
                  <h2 className="text-4xl font-black italic uppercase tracking-tighter">Zero-Upload Packing</h2>
                  <div className="flex gap-4">
                    <div className="bg-white/20 backdrop-blur px-6 py-4 rounded-3xl border border-white/10">
                      <div className="text-[10px] font-bold text-white/50 uppercase tracking-widest mb-1">Total Assets</div>
                      <div className="text-2xl font-black font-mono">{assets.length}</div>
                    </div>
                    <div className="bg-white/20 backdrop-blur px-6 py-4 rounded-3xl border border-white/10">
                      <div className="text-[10px] font-bold text-white/50 uppercase tracking-widest mb-1">Available Unique</div>
                      <div className="text-2xl font-black font-mono">{assets.length}</div>
                    </div>
                  </div>
                  <p className="text-white/50 text-sm max-w-xl leading-relaxed">
                    为了节省您的内存并保护隐私，本工具通过生成<strong>本地搬运计划</strong>完成打包。
                    <br />
                    <span className="text-[#F27D26] font-bold">!!! 强完整性模式：每包必满 50 张，且每张图绝不重复。若素材不足以凑满整包，将自动舍弃余数。</span>
                  </p>
                </div>
                <button 
                  onClick={() => setActiveTab('pack')} 
                  disabled={assets.length === 0}
                  className={`px-10 py-5 rounded-[2rem] font-black uppercase tracking-tighter transition-all shadow-lg relative z-10 ${
                    assets.length === 0 ? 'bg-gray-700 text-gray-500 cursor-not-allowed opacity-50' : 'bg-[#F27D26] text-white hover:scale-105'
                  }`}
                >
                   去配置生成规则
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
                              <div className="text-[10px] font-bold text-gray-400">检测到 {batch.count} 张有效图片</div>
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
            <div className="space-y-8 pb-32">
              <div className="flex justify-between items-end bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm">
                <div className="space-y-1">
                  <h2 className="text-3xl font-black italic tracking-tighter uppercase">手动分类 (Categorization)</h2>
                  <p className="text-gray-400 text-xs font-bold uppercase tracking-widest font-mono">
                    拖拽至右侧分类，或选中多张后点击分类卡片上的分配
                  </p>
                </div>
                <div className="flex flex-col md:flex-row gap-3">
                  <div className="flex flex-wrap gap-2 items-center">
                    {customCategories.map(cat => (
                      <div key={cat} className="flex items-center gap-1 bg-orange-50 border border-orange-100 px-3 py-1.5 rounded-full text-[10px] font-black text-[#F27D26] uppercase">
                        {cat}
                        <button onClick={() => setCustomCategories(prev => prev.filter(c => c !== cat))} className="hover:text-red-500 transition-colors">
                          <Plus className="w-3 h-3 rotate-45" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex bg-gray-100 p-1 rounded-xl items-center">
                    <Plus className="w-3 h-3 text-gray-400 ml-2" />
                    <input 
                      type="text" 
                      placeholder="回车添加自定义品类..." 
                      className="bg-transparent px-3 py-2 text-xs font-bold outline-none w-40"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = (e.target as HTMLInputElement).value.trim();
                          if (val && !allCategories.includes(val)) {
                            setCustomCategories(prev => [...prev, val]);
                            (e.target as HTMLInputElement).value = '';
                          }
                        }
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-12 gap-8 h-[600px]">
                {/* Pending Pool */}
                <div className="col-span-4 bg-white rounded-[2.5rem] border border-gray-200 overflow-hidden flex flex-col shadow-sm">
                  <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                    <span className="font-black text-xs uppercase tracking-widest">待分类池 ({assets.filter(a => !a.category).length})</span>
                    <button 
                      onClick={() => setSelectedAssetIdsForTagging([])}
                      className="text-[10px] text-gray-400 hover:text-gray-900 font-bold"
                    >
                      清空选中
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 gap-3 content-start">
                    {assets.filter(a => !a.category).map(asset => (
                      <div 
                        key={asset.id} 
                        draggable 
                        onDragStart={(e) => e.dataTransfer.setData('assetId', asset.id)}
                        onClick={() => setSelectedAssetIdsForTagging(prev => 
                          prev.includes(asset.id) ? prev.filter(i => i !== asset.id) : [...prev, asset.id]
                        )}
                        className={`aspect-square bg-white border rounded-3xl p-1.5 cursor-pointer transition-all group overflow-hidden relative shadow-sm flex items-center justify-center ${
                          selectedAssetIdsForTagging.includes(asset.id) ? 'border-[#F27D26] ring-4 ring-[#F27D26]/30' : 'border-gray-100 hover:border-gray-300'
                        }`}
                      >
                        <img src={asset.previewUrl} className="max-w-full max-h-full object-contain" alt="" />
                        <div className="absolute top-1 right-1 bg-white/90 backdrop-blur rounded-lg px-2 py-1 text-[8px] font-black border border-gray-100">
                          {asset.pieceSize}X{asset.pieceSize}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Categories Grid */}
                <div className="col-span-8 overflow-y-auto pr-4 grid grid-cols-2 xl:grid-cols-3 gap-6 content-start">
                  {allCategories.map(cat => {
                    const catAssets = assets.filter(a => a.category === cat);
                    return (
                      <div 
                        key={cat}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          const assetId = e.dataTransfer.getData('assetId');
                          setAssets(prev => prev.map(a => a.id === assetId ? { ...a, category: cat } : a));
                        }}
                        className="bg-white rounded-[2rem] border border-gray-200 p-6 shadow-sm min-h-[200px] flex flex-col group hover:border-[#F27D26] transition-colors"
                      >
                        <div className="flex justify-between items-center mb-4">
                          <h4 className="font-black italic uppercase tracking-tighter text-sm truncate">{cat}</h4>
                          <div className="flex items-center gap-2">
                            {selectedAssetIdsForTagging.length > 0 && (
                              <button 
                                onClick={() => {
                                  setAssets(prev => prev.map(a => selectedAssetIdsForTagging.includes(a.id) ? { ...a, category: cat } : a));
                                  setSelectedAssetIdsForTagging([]);
                                }}
                                className="bg-[#F27D26] text-white p-1 rounded-md hover:scale-110"
                                title="将选中素材分配到此分类"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            )}
                            <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-lg text-[10px] font-black font-mono">
                              {catAssets.length}
                            </span>
                          </div>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto no-scrollbar grid grid-cols-3 gap-2">
                           {catAssets.map(asset => (
                              <div key={asset.id} className="aspect-square rounded-xl bg-white border border-gray-100 relative group/item">
                                 <img src={asset.previewUrl} className="w-full h-full object-contain rounded-xl" alt="" />
                                 <button 
                                   onClick={() => setAssets(prev => prev.map(a => a.id === asset.id ? { ...a, category: undefined } : a))}
                                   className="absolute -top-1 -right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover/item:opacity-100 transition-opacity"
                                 >
                                    <Trash2 className="w-2 h-2" />
                                 </button>
                              </div>
                           ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Bottom Sticky Bar */}
              <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-[90%] max-w-5xl bg-[#1A1A1A] p-6 rounded-[2.5rem] text-white flex justify-between items-center shadow-2xl z-40">
                  <div className="flex items-center gap-8">
                     <div className="space-y-1">
                        <div className="text-[10px] font-black text-white/30 uppercase tracking-widest">Progress</div>
                        <div className="flex items-center gap-2">
                           <div className="w-32 h-2 bg-white/10 rounded-full overflow-hidden">
                              <div className="h-full bg-green-500" style={{ width: `${(assets.filter(a => a.category).length / assets.length * 100) || 0}%` }}></div>
                           </div>
                           <span className="text-xs font-black italic">{assets.filter(a => a.category).length} / {assets.length}</span>
                        </div>
                     </div>
                  </div>
                  
                  <div className="flex gap-4">
                    <button 
                      onClick={() => setActiveTab('pack')}
                      className="px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest text-white/40 hover:text-white transition-colors"
                    >
                      跳过所有分类与标记
                    </button>
                    <button 
                      onClick={() => setActiveTab('properties')}
                      className="bg-[#F27D26] text-white px-10 py-3 rounded-2xl font-black uppercase tracking-tighter hover:scale-105 transition-transform flex items-center gap-2"
                    >
                      去标记属性 <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
              </div>
            </div>
          )}

          {activeTab === 'properties' && (
            <div className="space-y-8 pb-32">
              <div className="flex justify-between items-end bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm">
                <div className="space-y-1">
                  <h2 className="text-3xl font-black italic tracking-tighter uppercase">素材属性标记 (Properties)</h2>
                  <p className="text-gray-400 text-xs font-bold uppercase tracking-widest font-mono">
                    标记图片饱和度与难度，将用于更精准的权重算法
                  </p>
                </div>
                <div className="flex gap-2">
                   <button 
                     onClick={() => {
                        const ids = assets.filter(a => a.category).map(a => a.id);
                        setSelectedAssetIdsForTagging(ids);
                     }}
                     className="px-4 py-2 bg-gray-100 rounded-xl text-[10px] font-black uppercase hover:bg-gray-200"
                   >
                     全选已分类图片
                   </button>
                   <button 
                     onClick={() => setSelectedAssetIdsForTagging([])}
                     className="px-4 py-2 bg-gray-100 rounded-xl text-[10px] font-black uppercase hover:bg-gray-200"
                   >
                     取消选中
                   </button>
                </div>
              </div>

              <div className="grid grid-cols-12 gap-8">
                 {/* Left: Selection Pool */}
                 <div className="col-span-8 bg-white rounded-[2.5rem] border border-gray-200 shadow-sm p-6">
                    <div className="grid grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 content-start">
                       {assets.map(asset => (
                         <div 
                           key={asset.id} 
                           onClick={() => setSelectedAssetIdsForTagging(prev => 
                             prev.includes(asset.id) ? prev.filter(i => i !== asset.id) : [...prev, asset.id]
                           )}
                           className={`aspect-square rounded-2xl overflow-hidden border p-1 cursor-pointer transition-all relative ${
                             selectedAssetIdsForTagging.includes(asset.id) ? 'border-[#F27D26] ring-4 ring-[#F27D26]' : 'border-gray-100'
                           }`}
                         >
                           <img src={asset.previewUrl} className="w-full h-full object-contain rounded-xl" alt="" />
                           {!asset.category && <div className="absolute top-2 left-2 bg-red-500 text-white p-0.5 rounded shadow-sm"><AlertCircle className="w-3 h-3" /></div>}
                           <div className="absolute top-2 right-2 flex flex-col gap-1">
                              {asset.saturation && (
                                <span className="bg-[#1A1A1A] text-white text-[8px] px-1 rounded-sm font-black uppercase">{asset.saturation}</span>
                              )}
                              {asset.difficulty && (
                                <span className="bg-blue-500 text-white text-[8px] px-1 rounded-sm font-black uppercase">{asset.difficulty}</span>
                              )}
                           </div>
                         </div>
                       ))}
                    </div>
                 </div>

                 {/* Right: Tagging Controller */}
                 <div className="col-span-4 space-y-6">
                    <div className="bg-white rounded-[2.5rem] border border-gray-200 shadow-sm p-8 sticky top-32">
                       <h3 className="text-xl font-black italic uppercase tracking-tighter mb-6 flex items-center justify-between">
                         批量操作面板
                         <span className="text-[#F27D26] text-xs font-mono">{selectedAssetIdsForTagging.length} SELECTED</span>
                       </h3>

                       <div className="space-y-8">
                          {/* Saturation Block */}
                          <div className="space-y-4">
                             <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                <Search className="w-3 h-3" /> 点击设置饱和度 (Saturation)
                             </div>
                             <div className="grid grid-cols-3 gap-2">
                                {Object.keys(SATURATION_MAP).map(sat => (
                                  <button 
                                    key={sat}
                                    disabled={selectedAssetIdsForTagging.length === 0}
                                    onClick={() => {
                                      setAssets(prev => prev.map(a => selectedAssetIdsForTagging.includes(a.id) ? { ...a, saturation: sat } : a));
                                    }}
                                    className="py-3 bg-gray-50 hover:bg-[#F27D26] hover:text-white rounded-xl text-xs font-black uppercase transition-all disabled:opacity-30"
                                  >
                                    {sat}
                                  </button>
                                ))}
                             </div>
                          </div>

                          {/* Difficulty Block */}
                          <div className="space-y-4">
                             <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                               <Target className="w-3 h-3" /> 点击设置难度 (Difficulty)
                             </div>
                             <div className="grid grid-cols-3 gap-2">
                                {Object.keys(DIFFICULTY_MAP).map(diff => (
                                  <button 
                                    key={diff}
                                    disabled={selectedAssetIdsForTagging.length === 0}
                                    onClick={() => {
                                      setAssets(prev => prev.map(a => selectedAssetIdsForTagging.includes(a.id) ? { ...a, difficulty: diff } : a));
                                    }}
                                    className="py-3 bg-gray-50 hover:bg-blue-500 hover:text-white rounded-xl text-xs font-black uppercase transition-all disabled:opacity-30"
                                  >
                                    {diff}
                                  </button>
                                ))}
                             </div>
                          </div>

                          <div className="pt-8 border-t border-gray-100 flex items-center gap-3 text-xs text-gray-400 italic">
                             <AlertCircle className="w-4 h-4 text-orange-400" />
                             标记后的属性将直接体现于最终导出的文件名中。
                          </div>
                       </div>
                    </div>
                 </div>
              </div>

              {/* Bottom Sticky Bar */}
              <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-[90%] max-w-5xl bg-[#1A1A1A] p-6 rounded-[2.5rem] text-white flex justify-between items-center shadow-2xl z-40">
                  <div className="flex items-center gap-4">
                     <div className="bg-white/10 px-6 py-3 rounded-2xl flex gap-6">
                        <div className="flex flex-col">
                           <span className="text-[8px] text-white/30 uppercase font-black">Saturation Marked</span>
                           <span className="text-sm font-black font-mono">{assets.filter(a => a.saturation).length}</span>
                        </div>
                        <div className="flex flex-col">
                           <span className="text-[8px] text-white/30 uppercase font-black">Difficulty Marked</span>
                           <span className="text-sm font-black font-mono">{assets.filter(a => a.difficulty).length}</span>
                        </div>
                     </div>
                  </div>
                  
                  <div className="flex gap-4">
                     <button 
                      onClick={() => setActiveTab('pack')}
                      className="bg-[#F27D26] text-white px-10 py-3 rounded-2xl font-black uppercase tracking-tighter hover:scale-105 transition-transform flex items-center gap-2"
                    >
                      完成并去生成关卡 <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
              </div>
            </div>
          )}

          {activeTab === 'pack' && (
            <motion.div key="pack" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 lg:grid-cols-3 gap-12 py-10">
               <div className="lg:col-span-1 border-r border-gray-200 pr-12 space-y-12">
                  <div className="space-y-8">
                    <h3 className="text-2xl font-black italic uppercase tracking-tighter flex items-center gap-2">
                       <Settings className="w-6 h-6" /> 配置打包任务
                    </h3>
                    
                    <div className="bg-[#1A1A1A] p-6 rounded-3xl text-white space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-white/40 uppercase font-bold tracking-widest">预设组数</span>
                        <span className="text-xl font-black font-mono">{batchCount} ({(batchCount * 50).toLocaleString()} 关)</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-white/40 uppercase font-bold tracking-widest">可供唯一素材</span>
                        <span className="text-xl font-black font-mono text-green-400">
                          {assets.length.toLocaleString()}
                        </span>
                      </div>
                      <div className="pt-4 border-t border-white/10 flex justify-between items-center">
                        <span className="text-xs text-[#F27D26] uppercase font-bold tracking-widest">最终将生成</span>
                        <span className="text-2xl font-black font-mono text-[#F27D26]">
                          {Math.min(batchCount, Math.floor(assets.length / 50))} <span className="text-xs">个整包</span>
                        </span>
                      </div>
                      
                      {assets.length < batchCount * 50 && (
                        <div className="pt-2 flex items-start gap-2 text-[10px] text-red-400 leading-tight font-bold italic bg-red-400/10 p-3 rounded-xl border border-red-400/20">
                          <AlertCircle className="w-3 h-3 flex-shrink-0" />
                          <span>注意：由于素材总数 ({assets.length}) 不足，仅能生成 {Math.floor(assets.length / 50)} 个完整的关卡包。请补充素材以凑齐 {batchCount} 组。</span>
                        </div>
                      )}
                    </div>

                      <div className="space-y-4 pt-4 border-t border-white/10">
                        <label className="text-[10px] font-black uppercase tracking-widest text-[#F27D26]">规格序列规则 (Sequence Rule)</label>
                        <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                           <div className="flex items-center gap-2 mb-2">
                             <div className="px-2 py-1 bg-[#F27D26] text-white text-[10px] font-black rounded-lg">4x4</div>
                             <ArrowRight className="w-3 h-3 text-white/20" />
                             <div className="px-2 py-1 bg-[#F27D26] text-white text-[10px] font-black rounded-lg">4x4</div>
                             <ArrowRight className="w-3 h-3 text-white/20" />
                             <div className="px-2 py-1 bg-white text-[#1A1A1A] text-[10px] font-black rounded-lg">6x6</div>
                           </div>
                           <p className="text-[9px] text-white/40 leading-relaxed italic">当前已锁定为固定的 [4x4 → 4x4 → 6x6] 循环序列，无需手动配置比重。</p>
                        </div>
                      </div>

                      <div className="space-y-4 pt-4 border-t border-white/10">
                        <label className="text-[10px] font-black uppercase tracking-widest text-indigo-400">饱和度配比 (Saturation Weights %)</label>
                        <div className="space-y-3">
                           {Object.entries(satWeights).map(([key, val]) => (
                             <div key={key} className="space-y-1">
                               <div className="flex justify-between text-[8px] font-bold text-white/40 uppercase">
                                 <span>{key}饱和度期望</span>
                                 <span>{val}%</span>
                               </div>
                               <input 
                                 type="range" 
                                 min="0" 
                                 max="100" 
                                 value={val} 
                                 onChange={e => setSatWeights(prev => {
                                   const newWeights = { ...prev, [key]: parseInt(e.target.value) };
                                   // Simple normalization attempt or just leave as is for variety
                                   return newWeights;
                                 })} 
                                 className="w-full h-1 bg-gray-700 rounded-full accent-indigo-400" 
                               />
                             </div>
                           ))}
                        </div>
                        <p className="text-[9px] text-white/20 italic">选片时将尽可能按此权重优先筛选对应标注的素材</p>
                      </div>

                      <div className="space-y-4 pt-4 border-t border-white/10">
                        <label className="text-[10px] font-black uppercase tracking-widest text-[#F27D26]">文件名构造规则 (Naming Scheme)</label>
                        <div className="space-y-3 p-4 bg-black/40 rounded-3xl border border-white/5 shadow-inner">
                          <Reorder.Group axis="y" values={namingScheme} onReorder={setNamingScheme} className="space-y-2">
                            {namingScheme.map((item) => (
                              <Reorder.Item 
                                key={item.id} 
                                value={item}
                                className={`p-3 rounded-xl border flex items-center justify-between transition-all select-none ${
                                  item.enabled 
                                    ? 'bg-white/5 border-white/20 shadow-lg' 
                                    : 'bg-black/20 border-white/5 opacity-40 grayscale'
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <div className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center cursor-grab active:cursor-grabbing hover:bg-white/10 transition-colors">
                                    <GripVertical className="w-3.5 h-3.5 text-white/40" />
                                  </div>
                                  <span className={`text-xs font-bold ${item.enabled ? 'text-white' : 'text-white/40'}`}>{item.label}</span>
                                </div>
                                <button 
                                  onClick={() => setNamingScheme(prev => prev.map(c => c.id === item.id ? { ...c, enabled: !c.enabled } : c))}
                                  className={`w-8 h-4 rounded-full relative transition-all duration-300 ${item.enabled ? 'bg-[#F27D26]' : 'bg-gray-800'}`}
                                >
                                  <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all duration-300 ${item.enabled ? 'right-0.5 shadow-[0_0_8px_rgba(242,125,38,0.8)]' : 'left-0.5'}`} />
                                </button>
                              </Reorder.Item>
                            ))}
                          </Reorder.Group>
                          
                          <div className="bg-white/5 p-3 rounded-xl border border-dashed border-white/10">
                            <div className="text-[7px] font-black text-white/40 uppercase mb-1.5 tracking-tighter">导出示例 (Export Sample)</div>
                            <div className="text-[10px] font-mono font-medium text-[#F27D26] break-all leading-tight bg-black/20 p-2 rounded-lg border border-black/40 shadow-inner">
                              {buildFileName(1, 4, { name: 'landscape', category: '自然景观', saturation: '高' } as any)}.png
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-6 pt-4 border-t border-white/10">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">起始关卡编号</label>
                        <input type="number" value={startLevel} onChange={e => setStartLevel(parseInt(e.target.value) || 1)} className="w-full bg-white border border-gray-200 p-5 rounded-2xl font-mono font-bold text-3xl shadow-inner focus:border-[#1A1A1A] outline-none transition-colors" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">生成组数 (每组50关)</label>
                        <input type="number" value={batchCount} onChange={e => setBatchCount(parseInt(e.target.value) || 1)} className="w-full bg-white border border-gray-200 p-5 rounded-2xl font-mono font-bold text-3xl shadow-inner focus:border-[#1A1A1A] outline-none transition-colors" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">同品类回避间隔 (关)</label>
                        <div className="flex items-center gap-4">
                           <input type="range" min="0" max="100" value={categoryGap} onChange={e => setCategoryGap(parseInt(e.target.value) || 0)} className="flex-1 h-2 bg-gray-200 rounded-full accent-[#1A1A1A]" />
                           <span className="font-mono font-bold text-xl w-10 text-right">{categoryGap}</span>
                        </div>
                        <p className="text-[9px] text-gray-400 font-medium">设置连续多少关内不出现同一品类图</p>
                      </div>
                      <button 
                        onClick={generatePlan} 
                        disabled={isGenerating}
                        className={`w-full py-8 text-white rounded-[2rem] font-black uppercase text-xl shadow-2xl transition-all flex items-center justify-center gap-4 ${
                          isGenerating ? 'bg-gray-400 cursor-not-allowed' : 'bg-[#F27D26] hover:scale-[1.02]'
                        }`}
                      >
                        {isGenerating ? (
                          <>
                            <div className="w-6 h-6 border-4 border-white/30 border-t-white rounded-full animate-spin"></div>
                            正在计算初始计划...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-6 h-6" /> {plan.length > 0 ? '重新计算随机计划' : '点击生成初始计划'}
                          </>
                        )}
                      </button>

                      {plan.length > 0 && (
                        <button 
                          onClick={exportZip} 
                          disabled={isZipping}
                          className={`w-full py-8 text-white rounded-[2rem] font-black uppercase text-xl shadow-2xl transition-all flex items-center justify-center gap-4 ${
                            isZipping ? 'bg-gray-400 cursor-not-allowed' : 'bg-[#1A1A1A] hover:scale-[1.02]'
                          }`}
                        >
                          {isZipping ? (
                            <>
                              <div className="w-6 h-6 border-4 border-white/30 border-t-white rounded-full animate-spin"></div>
                              正在由于资源导出...
                            </>
                          ) : (
                            <>
                              <Download className="w-6 h-6" /> 导出最终打包套件
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="bg-indigo-50 border border-indigo-100 p-8 rounded-[2rem] space-y-3">
                     <p className="text-xs text-indigo-900 leading-relaxed">
                       <strong>注意：</strong> 下载得到的 ZIP 包中包含 <code>.py</code> 脚本和 <code>.csv</code> 计划。您可以将它们拷贝到素材库根目录运行，无需互联网连接即可完成。
                     </p>
                  </div>
               </div>

               <div className="lg:col-span-2 space-y-12">
                  <div className="relative group">
                     <div className="absolute inset-x-0 bottom-[-10px] h-20 bg-[#1A1A1A] rounded-[3rem] opacity-10 blur-2xl group-hover:opacity-20 transition-opacity"></div>
                     <div className="bg-white p-12 rounded-[3.5rem] border border-gray-200 relative z-10 space-y-8 text-center">
                        <div className="w-32 h-32 bg-indigo-50 rounded-full flex items-center justify-center mx-auto shadow-inner">
                           <FileText className="w-16 h-16 text-indigo-500" />
                        </div>
                        <div className="space-y-4">
                          <h2 className="text-5xl font-black italic tracking-tighter uppercase">Local Execution</h2>
                          <p className="text-gray-400 text-lg leading-snug max-w-lg mx-auto">
                            只需三步：<br />
                            1. 解压工具包<br />
                            2. 放入素材根目录<br />
                            3. 启动 Python 脚本
                          </p>
                        </div>
                        <div className="bg-gray-50 p-6 rounded-3xl font-mono text-left max-w-md mx-auto relative group-hover:bg-gray-100 transition-colors">
                           <p className="text-xs text-indigo-400 mb-2"># Terminal Command</p>
                           <p className="text-sm font-bold text-[#1A1A1A]">python3 run_packer.py</p>
                           <div className="absolute top-4 right-4 text-[10px] font-bold text-gray-300 uppercase">CLI V3.0</div>
                        </div>
                     </div>
                  </div>
               </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
