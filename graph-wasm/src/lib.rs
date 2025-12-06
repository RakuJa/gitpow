use byteorder::{LittleEndian, WriteBytesExt};
use indexmap::IndexMap;
use serde::Deserialize;
use std::collections::HashSet;
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
struct CommitIn {
    sha: String,
    parents: Vec<String>,
    timestamp: i64,
    author: Option<String>,
    message: Option<String>,
}

#[wasm_bindgen]
pub struct LaneResult {
    buf: Vec<u8>,
}

#[wasm_bindgen]
impl LaneResult {
    #[wasm_bindgen(getter)]
    pub fn buffer(&self) -> js_sys::Uint8Array {
        js_sys::Uint8Array::from(&self.buf[..])
    }
}

#[wasm_bindgen]
pub fn build_lanes(json_commits: &str) -> Result<LaneResult, JsValue> {
    // Better error visibility instead of trap
    console_error_panic_hook::set_once();

    std::panic::catch_unwind(|| build_lanes_inner(json_commits))
        .unwrap_or_else(|e| Err(JsValue::from_str(&format!("panic in build_lanes: {:?}", e))))
}

fn build_lanes_inner(json_commits: &str) -> Result<LaneResult, JsValue> {
    let commits: Vec<CommitIn> =
        serde_json::from_str(json_commits).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let mut map: IndexMap<String, usize> = IndexMap::new();
    for (i, c) in commits.iter().enumerate() {
        map.insert(c.sha.clone(), i);
    }

    // Topological + timestamp ordering (stable)
    let mut indeg = vec![0usize; commits.len()];
    for c in &commits {
        for p in &c.parents {
            if let Some(&pid) = map.get(p) {
                indeg[pid] += 1;
            }
        }
    }

    use std::cmp::Reverse;
    use std::collections::BinaryHeap;
    let mut heap: BinaryHeap<(Reverse<i64>, Reverse<usize>, usize)> = BinaryHeap::new();
    for (i, c) in commits.iter().enumerate() {
        if indeg[i] == 0 {
            heap.push((Reverse(c.timestamp), Reverse(i), i));
        }
    }

    let mut topo: Vec<usize> = Vec::with_capacity(commits.len());
    // Track visited indices with HashSet for O(1) lookup (fixes O(N²) issue)
    let mut visited: HashSet<usize> = HashSet::with_capacity(commits.len());

    while let Some((_t, _ins, idx)) = heap.pop() {
        topo.push(idx);
        visited.insert(idx);
        for p in &commits[idx].parents {
            if let Some(&pid) = map.get(p) {
                if indeg[pid] > 0 {
                    indeg[pid] -= 1;
                    if indeg[pid] == 0 {
                        let pc = &commits[pid];
                        heap.push((Reverse(pc.timestamp), Reverse(pid), pid));
                    }
                }
            }
        }
    }
    // include remaining if cycles/disconnected - O(N) with HashSet lookup
    if topo.len() != commits.len() {
        for i in 0..commits.len() {
            if !visited.contains(&i) {
                topo.push(i);
            }
        }
    }

    // Lane assignment with reuse
    let mut active: Vec<Option<usize>> = Vec::new();
    let mut lane_of = vec![u16::MAX; commits.len()];
    for &ci in topo.iter() {
        // Prefer parent lane
        let mut assigned = None;
        for p in &commits[ci].parents {
            if let Some(&pid) = map.get(p) {
                let l = lane_of[pid] as usize;
                if l != usize::MAX {
                    assigned = Some(l);
                    break;
                }
            }
        }
        if assigned.is_none() {
            for (li, slot) in active.iter().enumerate() {
                if slot.is_none() {
                    assigned = Some(li);
                    break;
                }
            }
        }
        let lane_idx = assigned.unwrap_or_else(|| {
            active.push(None);
            active.len() - 1
        });
        lane_of[ci] = lane_idx as u16;
        active[lane_idx] = Some(ci);
        // free parent lanes
        for p in &commits[ci].parents {
            if let Some(&pid) = map.get(p) {
                let lp = lane_of[pid] as usize;
                if lp != usize::MAX {
                    active[lp] = None;
                }
            }
        }
    }

    // Edges
    let mut edges: Vec<(u32, u32)> = Vec::new();
    for (child_idx, c) in commits.iter().enumerate() {
        for p in &c.parents {
            if let Some(&pid) = map.get(p) {
                edges.push((child_idx as u32, pid as u32));
            }
        }
    }

    let commit_count = commits.len() as u32;
    let edge_count = edges.len() as u32;
    let mut buf: Vec<u8> = Vec::with_capacity(
        8 + commits.len() * (2 + 4 + 8) + edges.len() * (4 + 4 + 16),
    );
    buf.write_u32::<LittleEndian>(commit_count).unwrap();
    buf.write_u32::<LittleEndian>(edge_count).unwrap();

    for (pos, &ci) in topo.iter().enumerate() {
        let c = &commits[ci];
        buf.write_u16::<LittleEndian>(lane_of[ci]).unwrap();
        buf.write_u32::<LittleEndian>(pos as u32).unwrap();
        buf.write_f64::<LittleEndian>(c.timestamp as f64).unwrap();
    }

    for (from, to) in edges.iter() {
        let from_idx = *from as usize;
        let to_idx = *to as usize;
        // Bounds check to prevent panic
        if from_idx >= lane_of.len() || to_idx >= lane_of.len() {
            return Err(JsValue::from_str(&format!(
                "Edge index out of bounds: from={} to={} len={}",
                from_idx, to_idx, lane_of.len()
            )));
        }
        buf.write_u32::<LittleEndian>(*from).unwrap();
        buf.write_u32::<LittleEndian>(*to).unwrap();
        // control points placeholders (t handled in shader)
        buf.write_f32::<LittleEndian>(lane_of[from_idx] as f32).unwrap();
        buf.write_f32::<LittleEndian>(0.5).unwrap();
        buf.write_f32::<LittleEndian>(lane_of[to_idx] as f32).unwrap();
        buf.write_f32::<LittleEndian>(0.5).unwrap();
    }

    Ok(LaneResult { buf })
}
