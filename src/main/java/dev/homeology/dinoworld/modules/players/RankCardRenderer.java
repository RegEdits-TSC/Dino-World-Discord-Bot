package dev.homeology.dinoworld.modules.players;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.imageio.ImageIO;
import java.awt.AlphaComposite;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.Shape;
import java.awt.Stroke;
import java.awt.font.TextLayout;
import java.awt.geom.AffineTransform;
import java.awt.geom.Ellipse2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Optional;

/**
 * Renders a Discord-style rank card as a PNG byte array — used by
 * {@code /rank} to ship a single image attachment instead of a text
 * embed. Pure: no JDA, no I/O beyond an optional one-shot classpath
 * read for the background image and the in-memory PNG encode.
 *
 * <p>Layout (1086 × 362 — a 3:1 aspect ratio sized to match the
 * shipped {@code data/rank/background.png} asset):
 * <pre>
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │  ╭────────╮                                                     │
 *   │  │        │  Username                              LEVEL 12     │
 *   │  │  AVT   │                            420 / 1,200 XP           │
 *   │  ╰────────╯  ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░       │
 *   └─────────────────────────────────────────────────────────────────┘
 * </pre>
 *
 * <p>If {@code data/rank/background.png} is on the classpath, it's
 * composited under everything as the card backdrop (with a small dark
 * tint applied for text legibility). Missing background → fall back to
 * a solid Discord-dark fill so the card still renders cleanly.
 *
 * <p>Colors are pinned to Discord's palette so the card blends with the
 * client. Logical font names (SansSerif) are used so the renderer works
 * on any JDK install — even minimal headless Linux without extra fonts.
 */
public final class RankCardRenderer {

	private static final Logger log = LoggerFactory.getLogger(RankCardRenderer.class);

	/** Card width in pixels — matches a 3:1 background asset (e.g. 2172×724 → 2× downscale). */
	public static final int WIDTH = 1086;

	/** Card height in pixels. */
	public static final int HEIGHT = 362;

	/** Classpath location of the optional background asset. */
	static final String BACKGROUND_RESOURCE = "data/rank/background.png";

	private static final int CARD_RADIUS = 32;
	private static final int AVATAR_SIZE = 240;
	private static final int AVATAR_X = 40;
	private static final int AVATAR_Y = 60;
	private static final int AVATAR_RING = 5;
	private static final int RIGHT_COL_X = AVATAR_X + AVATAR_SIZE + 40;
	private static final int RIGHT_COL_RIGHT_PAD = 40;

	private static final Color CARD_BG = new Color(0x2C2F33);
	private static final Color CARD_INNER = new Color(0x23272A);
	private static final Color BAR_TRACK = new Color(0x4F545C);
	/** Warm amber-gold — biased a touch toward orange so it reads as "rich
	 *  golden yellow" rather than bright lemon-yellow against the banner art.
	 *  Used for the progress bar fill, the LEVEL pill text, and the avatar ring. */
	private static final Color ACCENT_GOLD = new Color(0xFFB300);
	private static final Color TEXT_PRIMARY = new Color(0xFFFFFF);
	private static final Color TEXT_SECONDARY = new Color(0xE6E8EB);
	/** Black outline applied around all foreground text so it stays legible
	 *  against any background art — the dark tint alone isn't enough when the
	 *  background has bright spots behind a glyph. */
	private static final Color TEXT_OUTLINE = new Color(0, 0, 0, 220);
	private static final float TEXT_OUTLINE_STROKE = 4f;
	/** Dark tint composited over the background image — keeps white text readable
	 *  regardless of how bright the user's background asset is. ~30% opacity. */
	private static final Color BG_TINT = new Color(0, 0, 0, 80);

	/** Lazily-loaded shared background image. {@link Optional#empty()} after a
	 *  failed load means "no asset" — the renderer falls back to {@link #CARD_BG}. */
	private static volatile Optional<BufferedImage> backgroundCache;

	private RankCardRenderer() {}

	/**
	 * Render one rank card to a PNG byte array.
	 *
	 * @param displayName user-visible name (truncated to fit if too long)
	 * @param level       current level (≥ 1)
	 * @param xpInLevel   XP earned within the current level (≥ 0)
	 * @param xpToNext    XP needed to advance from {@code level} to
	 *                    {@code level + 1} (must be &gt; 0)
	 * @param avatar      square avatar image; pass {@code null} to render
	 *                    a placeholder ring with a "?" glyph
	 * @return PNG-encoded bytes ready to attach to a Discord message
	 */
	public static byte[] render(String displayName, int level,
	                            long xpInLevel, long xpToNext,
	                            BufferedImage avatar) {
		if (xpToNext <= 0) throw new IllegalArgumentException("xpToNext must be > 0");
		if (level < 1) throw new IllegalArgumentException("level must be ≥ 1");

		BufferedImage img = new BufferedImage(WIDTH, HEIGHT, BufferedImage.TYPE_INT_ARGB);
		Graphics2D g = img.createGraphics();
		try {
			g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
			g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING,
				RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
			g.setRenderingHint(RenderingHints.KEY_INTERPOLATION,
				RenderingHints.VALUE_INTERPOLATION_BICUBIC);

			drawBackground(g);
			drawAvatar(g, avatar);
			drawText(g, displayName, level, xpInLevel, xpToNext);
			drawProgressBar(g, xpInLevel, xpToNext);
		} finally {
			g.dispose();
		}

		ByteArrayOutputStream out = new ByteArrayOutputStream();
		try {
			ImageIO.write(img, "PNG", out);
		} catch (IOException e) {
			throw new IllegalStateException("PNG encode failed", e);
		}
		return out.toByteArray();
	}

	private static void drawBackground(Graphics2D g) {
		RoundRectangle2D.Float card = new RoundRectangle2D.Float(
			0, 0, WIDTH, HEIGHT, CARD_RADIUS, CARD_RADIUS);

		Optional<BufferedImage> bg = loadBackground();
		if (bg.isPresent()) {
			// Composite the user's background asset, clipped to the card's
			// rounded corners. Dark tint on top so text stays readable
			// against bright/busy art.
			var oldClip = g.getClip();
			try {
				g.setClip(card);
				g.drawImage(bg.get(), 0, 0, WIDTH, HEIGHT, null);
				g.setColor(BG_TINT);
				g.fillRect(0, 0, WIDTH, HEIGHT);
			} finally {
				g.setClip(oldClip);
			}
		} else {
			g.setColor(CARD_BG);
			g.fill(card);
		}

		// Subtle inner panel hairline so the card has visible structure.
		g.setColor(CARD_INNER);
		g.setStroke(new BasicStroke(1f));
		g.draw(new RoundRectangle2D.Float(0.5f, 0.5f, WIDTH - 1f, HEIGHT - 1f,
			CARD_RADIUS, CARD_RADIUS));
	}

	private static void drawAvatar(Graphics2D g, BufferedImage avatar) {
		// Gold ring around the avatar circle — matches the LEVEL/XP accent.
		g.setColor(ACCENT_GOLD);
		g.fill(new Ellipse2D.Float(
			AVATAR_X - AVATAR_RING, AVATAR_Y - AVATAR_RING,
			AVATAR_SIZE + 2f * AVATAR_RING, AVATAR_SIZE + 2f * AVATAR_RING));

		Ellipse2D.Float clip = new Ellipse2D.Float(AVATAR_X, AVATAR_Y, AVATAR_SIZE, AVATAR_SIZE);
		if (avatar == null) {
			// Placeholder: dark fill with a "?" glyph so the layout still
			// works when the avatar download fails.
			g.setColor(CARD_INNER);
			g.fill(clip);
			g.setColor(TEXT_SECONDARY);
			g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 120));
			drawCenteredString(g, "?",
				AVATAR_X, AVATAR_Y, AVATAR_SIZE, AVATAR_SIZE);
			return;
		}

		// Composite the avatar inside a circular clip. Use a save/restore on
		// composite + clip so the surrounding draws aren't affected.
		var oldClip = g.getClip();
		var oldComposite = g.getComposite();
		try {
			g.setClip(clip);
			g.setComposite(AlphaComposite.SrcOver);
			g.drawImage(avatar, AVATAR_X, AVATAR_Y, AVATAR_SIZE, AVATAR_SIZE, null);
		} finally {
			g.setClip(oldClip);
			g.setComposite(oldComposite);
		}
	}

	private static void drawText(Graphics2D g, String name, int level,
	                             long xpInLevel, long xpToNext) {
		// All foreground text is drawn via drawOutlinedString so it stays
		// legible against any background art — the dark tint over the banner
		// isn't enough on its own when bright spots line up behind a glyph.

		// Username (top-left of right column) — truncate so it doesn't
		// crash into the level pill on the right.
		g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 52));
		String shownName = name == null || name.isBlank() ? "Unknown" : name;
		int nameMaxWidth = WIDTH - RIGHT_COL_X - RIGHT_COL_RIGHT_PAD - 220;
		shownName = truncateToFit(g, shownName, nameMaxWidth);
		drawOutlinedString(g, shownName, RIGHT_COL_X, AVATAR_Y + 60,
			TEXT_PRIMARY, TEXT_OUTLINE, TEXT_OUTLINE_STROKE);

		// Level pill on the right side of the same row, baseline-aligned with name.
		String levelText = "LEVEL " + level;
		g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 36));
		int levelWidth = g.getFontMetrics().stringWidth(levelText);
		int pillX = WIDTH - RIGHT_COL_RIGHT_PAD - levelWidth;
		drawOutlinedString(g, levelText, pillX, AVATAR_Y + 56,
			ACCENT_GOLD, TEXT_OUTLINE, TEXT_OUTLINE_STROKE);

		// XP text under the username, above the bar.
		g.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 28));
		String xpText = formatNumber(xpInLevel) + " / " + formatNumber(xpToNext) + " XP";
		int xpWidth = g.getFontMetrics().stringWidth(xpText);
		// Right-align XP text above the bar so the eye reads name → xp → bar fill.
		drawOutlinedString(g, xpText,
			WIDTH - RIGHT_COL_RIGHT_PAD - xpWidth,
			AVATAR_Y + 160,
			TEXT_SECONDARY, TEXT_OUTLINE, TEXT_OUTLINE_STROKE);
	}

	private static void drawProgressBar(Graphics2D g, long xpInLevel, long xpToNext) {
		int barX = RIGHT_COL_X;
		int barY = AVATAR_Y + 185;
		int barWidth = WIDTH - RIGHT_COL_RIGHT_PAD - barX;
		int barHeight = 40;

		g.setColor(BAR_TRACK);
		g.fill(new RoundRectangle2D.Float(barX, barY, barWidth, barHeight,
			barHeight, barHeight));

		double frac = Math.max(0.0, Math.min(1.0, (double) xpInLevel / (double) xpToNext));
		int fillWidth = (int) Math.round(frac * barWidth);
		// Below ~5% the rounded corners would render as a sliver; clamp to a
		// minimum visible nub when there's any progress at all so 1 XP still
		// shows on the bar.
		if (xpInLevel > 0 && fillWidth < barHeight) fillWidth = barHeight;
		if (fillWidth > 0) {
			g.setColor(ACCENT_GOLD);
			g.fill(new RoundRectangle2D.Float(barX, barY, fillWidth, barHeight,
				barHeight, barHeight));
		}
	}

	// ─── background loader ──────────────────────────────────────────────

	/**
	 * Lazily load the background asset from the classpath. Cached for the
	 * process lifetime; restart the bot to pick up a swapped PNG.
	 *
	 * @return the loaded image, or {@link Optional#empty()} when the asset
	 *         is missing or fails to decode (in which case the renderer
	 *         falls back to a solid-color background)
	 */
	static Optional<BufferedImage> loadBackground() {
		Optional<BufferedImage> snapshot = backgroundCache;
		if (snapshot != null) return snapshot;
		synchronized (RankCardRenderer.class) {
			if (backgroundCache != null) return backgroundCache;
			Optional<BufferedImage> loaded = readBackgroundResource();
			backgroundCache = loaded;
			return loaded;
		}
	}

	/**
	 * Test seam — drop the cached background so a follow-up
	 * {@link #loadBackground()} call re-reads the classpath. Production
	 * code never needs this; the cache is process-lifetime.
	 */
	static void resetBackgroundCacheForTest() {
		synchronized (RankCardRenderer.class) {
			backgroundCache = null;
		}
	}

	private static Optional<BufferedImage> readBackgroundResource() {
		try (InputStream in = Thread.currentThread().getContextClassLoader()
			.getResourceAsStream(BACKGROUND_RESOURCE)) {
			if (in == null) {
				log.info("Rank card background '{}' missing from classpath; using solid-color fallback",
					BACKGROUND_RESOURCE);
				return Optional.empty();
			}
			BufferedImage img = ImageIO.read(in);
			if (img == null) {
				log.warn("Rank card background '{}' did not decode as a known image format",
					BACKGROUND_RESOURCE);
				return Optional.empty();
			}
			log.debug("Loaded rank card background '{}' ({}×{})",
				BACKGROUND_RESOURCE, img.getWidth(), img.getHeight());
			return Optional.of(img);
		} catch (Exception e) {
			log.warn("Failed to load rank card background '{}': {}",
				BACKGROUND_RESOURCE, e.toString());
			return Optional.empty();
		}
	}

	// ─── helpers ─────────────────────────────────────────────────────────

	/**
	 * Draw text with a stroked outline behind a solid fill, using the
	 * graphics context's currently-set font. Equivalent to
	 * {@link Graphics2D#drawString(String, int, int)} when {@code outline}
	 * is null, but renders glyphs as shapes so the outline can be
	 * thicker than a typical pixel — keeps the text readable against
	 * any background art.
	 */
	private static void drawOutlinedString(Graphics2D g, String text,
	                                       int x, int y,
	                                       Color fill, Color outline,
	                                       float strokeWidth) {
		if (text == null || text.isEmpty()) return;
		TextLayout layout = new TextLayout(text, g.getFont(), g.getFontRenderContext());
		Shape glyphShape = layout.getOutline(AffineTransform.getTranslateInstance(x, y));

		Stroke oldStroke = g.getStroke();
		Color oldColor = g.getColor();
		try {
			if (outline != null && strokeWidth > 0f) {
				g.setColor(outline);
				g.setStroke(new BasicStroke(strokeWidth,
					BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
				g.draw(glyphShape);
			}
			g.setColor(fill);
			g.fill(glyphShape);
		} finally {
			g.setStroke(oldStroke);
			g.setColor(oldColor);
		}
	}

	private static void drawCenteredString(Graphics2D g, String text,
	                                       int x, int y, int w, int h) {
		var fm = g.getFontMetrics();
		int tx = x + (w - fm.stringWidth(text)) / 2;
		int ty = y + ((h - fm.getHeight()) / 2) + fm.getAscent();
		g.drawString(text, tx, ty);
	}

	private static String truncateToFit(Graphics2D g, String text, int maxWidth) {
		var fm = g.getFontMetrics();
		if (fm.stringWidth(text) <= maxWidth) return text;
		String ell = "…";
		String trimmed = text;
		while (!trimmed.isEmpty()
			&& fm.stringWidth(trimmed + ell) > maxWidth) {
			trimmed = trimmed.substring(0, trimmed.length() - 1);
		}
		return trimmed + ell;
	}

	private static String formatNumber(long n) {
		// Thousand-separators keep large XP totals scannable (e.g. 12,345).
		return String.format(java.util.Locale.ROOT, "%,d", n);
	}
}
