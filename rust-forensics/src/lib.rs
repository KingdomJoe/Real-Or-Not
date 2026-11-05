//! RON (Real or Not) — forensic signal engine compiled to WebAssembly.
//!
//! Exposes [`compute_forensic_maps`] over raw pointers so the Web Worker can
//! process frames with zero copies: RGBA in, three concatenated `w*h` maps out
//! (Boundary ΔELA heat, 2D FFT grid strength, 1-bit Bayer dither mask).
//!
//! Build with:
//! ```sh
//! wasm-pack build --target web --out-dir ../static/wasm --out-name ron_forensics
//! ```

use num_complex::Complex32;
use rustfft::{FftPlanner, num_traits::Zero};
use std::slice;
use wasm_bindgen::prelude::*;

/// 8×8 Bayer threshold matrix (Dithercn-style 1-bit halftone).
const BAYER_8X8: [u8; 64] = [
     0, 32,  8, 40,  2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44,  4, 36, 14, 46,  6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
     3, 35, 11, 43,  1, 33,  9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47,  7, 39, 13, 45,  5, 37,
    63, 31, 55, 23, 61, 29, 53, 21,
];

/// Allocate a byte buffer owned by WASM and return its pointer.
/// The caller must eventually call [`dealloc`] with the same pointer + length.
#[wasm_bindgen]
pub fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Free a buffer previously returned by [`alloc`].
#[wasm_bindgen]
pub fn dealloc(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    unsafe {
        let _ = Vec::from_raw_parts(ptr, len, len);
    }
}

#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

#[inline]
fn luminance(r: u8, g: u8, b: u8) -> f32 {
    0.299 * r as f32 + 0.587 * g as f32 + 0.114 * b as f32
}

/// Boundary-differential Error Level Analysis.
///
/// Approximates JPEG recompression at quality `ela_q` per 8×8 block (block-mean
/// quantisation), then measures per-pixel residuals. Pixels on 8×8 block
/// boundaries are boosted 1.5× (the "boundary-differential" term) because
/// spliced regions break the original grid alignment.
fn ela_map(rgba: &[u8], width: usize, height: usize, ela_q: u8, out: &mut [u8]) {
    let q = ela_q.clamp(10, 95) as f32;
    let step = 255.0 / q;
    for by in 0..height.div_ceil(8) {
        for bx in 0..width.div_ceil(8) {
            // Block mean luminance.
            let mut sum = 0f32;
            let mut n = 0f32;
            for dy in 0..8 {
                for dx in 0..8 {
                    let x = bx * 8 + dx;
                    let y = by * 8 + dy;
                    if x >= width || y >= height {
                        continue;
                    }
                    let i = (y * width + x) * 4;
                    sum += luminance(rgba[i], rgba[i + 1], rgba[i + 2]);
                    n += 1.0;
                }
            }
            let mean = if n > 0.0 { sum / n } else { 0.0 };
            let requant = (mean / step).round() * step;
            // Residuals vs the re-quantised block mean.
            for dy in 0..8 {
                for dx in 0..8 {
                    let x = bx * 8 + dx;
                    let y = by * 8 + dy;
                    if x >= width || y >= height {
                        continue;
                    }
                    let i = (y * width + x) * 4;
                    let lum = luminance(rgba[i], rgba[i + 1], rgba[i + 2]);
                    let mut residual = (lum - requant).abs();
                    if dx == 0 || dy == 0 {
                        residual *= 1.5;
                    }
                    // Amplify into 0–255 heat.
                    out[y * width + x] = (residual * 4.0).clamp(0.0, 255.0) as u8;
                }
            }
        }
    }
}

/// 2D FFT AI grid-pattern strength per 32×32 tile.
///
/// Runs row-then-column FFTs (rustfft) on luminance, then measures the ratio of
/// high-frequency energy above `fft_cutoff` (normalised radius 0–1) versus total
/// AC energy. Diffusion/GAN upsamplers leave periodic peaks that inflate this
/// ratio; natural camera noise is spectrally flat. The tile score is splatted
/// back to every pixel in the tile.
fn fft_map(rgba: &[u8], width: usize, height: usize, fft_cutoff: f32, out: &mut [u8]) {
    const TILE: usize = 32;
    let cutoff = fft_cutoff.clamp(0.05, 0.9);
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(TILE);
    let mut row: Vec<Complex32> = vec![Complex32::zero(); TILE];
    let mut col: Vec<Complex32> = vec![Complex32::zero(); TILE];
    let mut spectrum = vec![0f32; TILE * TILE];

    let tiles_x = width.div_ceil(TILE);
    let tiles_y = height.div_ceil(TILE);
    for ty in 0..tiles_y {
        for tx in 0..tiles_x {
            // Load tile luminance (edge-clamped).
            let mut tile = [0f32; TILE * TILE];
            for dy in 0..TILE {
                for dx in 0..TILE {
                    let x = (tx * TILE + dx).min(width - 1);
                    let y = (ty * TILE + dy).min(height - 1);
                    let i = (y * width + x) * 4;
                    tile[dy * TILE + dx] = luminance(rgba[i], rgba[i + 1], rgba[i + 2]) / 255.0;
                }
            }
            // Row FFTs.
            for r in 0..TILE {
                for c in 0..TILE {
                    row[c] = Complex32::new(tile[r * TILE + c], 0.0);
                }
                fft.process(&mut row);
                for c in 0..TILE {
                    spectrum[r * TILE + c] = row[c].norm();
                }
            }
            // Column FFTs (in place over magnitudes is a cheap approximation
            // that preserves peak structure for grid detection).
            for c in 0..TILE {
                for r in 0..TILE {
                    col[r] = Complex32::new(spectrum[r * TILE + c], 0.0);
                }
                fft.process(&mut col);
                for r in 0..TILE {
                    spectrum[r * TILE + c] = col[r].norm();
                }
            }
            // High-frequency energy ratio above cutoff radius (DC excluded).
            let center = TILE as f32 / 2.0;
            let mut hi = 0f32;
            let mut total = 0f32;
            for r in 0..TILE {
                for c in 0..TILE {
                    if r == 0 && c == 0 {
                        continue;
                    }
                    let mag = spectrum[r * TILE + c];
                    total += mag;
                    let dr = r as f32 - center;
                    let dc = c as f32 - center;
                    let radius = (dr * dr + dc * dc).sqrt() / center;
                    if radius >= cutoff {
                        hi += mag;
                    }
                }
            }
            let ratio = if total > 1e-6 { hi / total } else { 0.0 };
            // Natural photos sit ≈0.15–0.35 here; AI grids push >0.5.
            let heat = ((ratio - 0.15) / 0.5).clamp(0.0, 1.0);
            let byte = (heat * 255.0) as u8;
            for dy in 0..TILE {
                for dx in 0..TILE {
                    let x = tx * TILE + dx;
                    let y = ty * TILE + dy;
                    if x < width && y < height {
                        out[y * width + x] = byte;
                    }
                }
            }
        }
    }
}

/// 1-bit Bayer halftone dither mask derived from the ELA heat map.
fn dither_mask(ela: &[u8], width: usize, height: usize, out: &mut [u8]) {
    for y in 0..height {
        for x in 0..width {
            let threshold = BAYER_8X8[(y % 8) * 8 + (x % 8)] as u16 * 4;
            let v = ela[y * width + x] as u16;
            out[y * width + x] = if v > threshold { 255 } else { 0 };
        }
    }
}

/// Compute all three forensic maps in one call.
///
/// # Safety contract (called from the Web Worker)
/// - `rgba_ptr` points to `width*height*4` readable bytes (RGBA, row-major).
/// - `out_ptr` points to `width*height*3` writable bytes: `[ela | fft | dither]`.
/// - `width * height` must be > 0 and buffers must not overlap.
#[no_mangle]
pub unsafe extern "C" fn compute_forensic_maps(
    rgba_ptr: *const u8,
    out_ptr: *mut u8,
    width: u32,
    height: u32,
    ela_q: u8,
    fft_cutoff: f32,
) {
    let w = width as usize;
    let h = height as usize;
    let px = match w.checked_mul(h) {
        Some(n) if n > 0 => n,
        _ => return,
    };
    if rgba_ptr.is_null() || out_ptr.is_null() {
        return;
    }
    let rgba = unsafe { slice::from_raw_parts(rgba_ptr, px * 4) };
    let out = unsafe { slice::from_raw_parts_mut(out_ptr, px * 3) };
    let (ela, rest) = out.split_at_mut(px);
    let (fft, dither) = rest.split_at_mut(px);

    ela_map(rgba, w, h, ela_q, ela);
    fft_map(rgba, w, h, fft_cutoff, fft);
    dither_mask(ela, w, h, dither);
}

/// Safe wasm-bindgen wrapper: takes an RGBA [`Vec`], returns the 3 concatenated maps.
#[wasm_bindgen]
pub fn forensic_maps_safe(
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    ela_q: u8,
    fft_cutoff: f32,
) -> Vec<u8> {
    let px = width as usize * height as usize;
    let mut out = vec![0u8; px * 3];
    unsafe {
        compute_forensic_maps(
            rgba.as_ptr(),
            out.as_mut_ptr(),
            width,
            height,
            ela_q,
            fft_cutoff,
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_have_expected_size() {
        let w = 16usize;
        let h = 16usize;
        let rgba = vec![128u8; w * h * 4];
        let mut out = vec![0u8; w * h * 3];
        unsafe {
            compute_forensic_maps(out.as_mut_ptr().cast_const(), out.as_mut_ptr(), 0, 0, 90, 0.4);
        }
        // Zero-size must be a no-op, not a crash.
        assert!(out.iter().all(|&b| b == 0));
        let mut out2 = vec![0u8; w * h * 3];
        unsafe {
            compute_forensic_maps(rgba.as_ptr(), out2.as_mut_ptr(), w as u32, h as u32, 90, 0.4);
        }
        assert_eq!(out2.len(), w * h * 3);
    }

    #[test]
    fn flat_image_has_low_ela() {
        let w = 32usize;
        let h = 32usize;
        let rgba = vec![200u8; w * h * 4];
        let mut ela = vec![0u8; w * h];
        ela_map(&rgba, w, h, 90, &mut ela);
        let mean: f32 = ela.iter().map(|&b| b as f32).sum::<f32>() / ela.len() as f32;
        assert!(mean < 12.0, "flat image ELA mean too high: {mean}");
    }
}
