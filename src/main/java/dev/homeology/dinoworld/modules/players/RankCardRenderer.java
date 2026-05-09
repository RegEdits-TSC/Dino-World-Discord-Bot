package dev.homeology.dinoworld.modules.players;

import javax.imageio.ImageIO;
import java.awt.AlphaComposite;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.Ellipse2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;

/**
 * Renders a Discord-style rank card as a PNG byte array — used by
 * {@code /rank} to ship a single image attachment instead of a text
 * embed. Pure: no JDA, no I/O beyond the in-memory PNG encode.
 *
 * <p>Layout (800 × 220):
 * <pre>
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │  ╭──────╮                                                      │
 *   │  │ AVT  │  Username                       Level 12             │
 *   │  ╰──────╯                                                      │
 *   │           ████████████████░░░░░░░░░░░░░░░░░░░░    420 / 800 XP │
 *   └────────────────────────────────────────────────────────────────┘
 * </pre>
 *
 * <p>Colors are pinned to Discord's palette so the card blends with the
 * client. Logical font names (SansSerif) are used so the renderer works
 * on any JDK install — even minimal headless Linux without extra fonts.
 */
public final class RankCardRenderer {

	/** Card width in pixels. */
	public static final int WIDTH = 800;

	/** Card height in pixels. */
	public static final int HEIGHT = 220;

	private static final int CARD_RADIUS = 24;
	private static final int AVATAR_SIZE = 160;
	private static final int AVATAR_X = 30;
	private static final int AVATAR_Y = 30;
	private static final int AVATAR_RING = 4;
	private static final int RIGHT_COL_X = AVATAR_X + AVATAR_SIZE + 30;
	private static final int RIGHT_COL_RIGHT_PAD = 30;

	private static final Color CARD_BG = new Color(0x2C2F33);
	private static final Color CARD_INNER = new Color(0x23272A);
	private static final Color BAR_TRACK = new Color(0x4F545C);
	private static final Color BAR_FILL = new Color(0x5865F2); // Discord blurple
	private static final Color TEXT_PRIMARY = new Color(0xFFFFFF);
	private static final Color TEXT_SECONDARY = new Color(0xB9BBBE);
	private static final Color AVATAR_RING_COLOR = new Color(0x5865F2);

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
		g.setColor(CARD_BG);
		g.fill(new RoundRectangle2D.Float(0, 0, WIDTH, HEIGHT, CARD_RADIUS, CARD_RADIUS));
		// Subtle inner panel hairline so the card has visible structure
		// even without an avatar present.
		g.setColor(CARD_INNER);
		g.setStroke(new BasicStroke(1f));
		g.draw(new RoundRectangle2D.Float(0.5f, 0.5f, WIDTH - 1f, HEIGHT - 1f,
			CARD_RADIUS, CARD_RADIUS));
	}

	private static void drawAvatar(Graphics2D g, BufferedImage avatar) {
		// Blurple ring around the avatar circle.
		g.setColor(AVATAR_RING_COLOR);
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
			g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 80));
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
		// Username (top-left of right column) — truncate to ~20 chars so
		// it doesn't crash into the level pill on the right.
		g.setColor(TEXT_PRIMARY);
		g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 38));
		String shownName = name == null || name.isBlank() ? "Unknown" : name;
		shownName = truncateToFit(g, shownName, WIDTH - RIGHT_COL_X - 200);
		g.drawString(shownName, RIGHT_COL_X, AVATAR_Y + 38);

		// Level pill on the right side of the same row, vertically aligned.
		String levelText = "LEVEL " + level;
		g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 26));
		int levelWidth = g.getFontMetrics().stringWidth(levelText);
		int pillX = WIDTH - RIGHT_COL_RIGHT_PAD - levelWidth;
		g.setColor(BAR_FILL);
		g.drawString(levelText, pillX, AVATAR_Y + 34);

		// XP text under the username, above the bar.
		g.setColor(TEXT_SECONDARY);
		g.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 22));
		String xpText = formatNumber(xpInLevel) + " / " + formatNumber(xpToNext) + " XP";
		int xpWidth = g.getFontMetrics().stringWidth(xpText);
		// Right-align XP text above the bar so the eye reads name → xp → bar fill.
		g.drawString(xpText,
			WIDTH - RIGHT_COL_RIGHT_PAD - xpWidth,
			AVATAR_Y + 100);
	}

	private static void drawProgressBar(Graphics2D g, long xpInLevel, long xpToNext) {
		int barX = RIGHT_COL_X;
		int barY = AVATAR_Y + 120;
		int barWidth = WIDTH - RIGHT_COL_RIGHT_PAD - barX;
		int barHeight = 28;

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
			g.setColor(BAR_FILL);
			g.fill(new RoundRectangle2D.Float(barX, barY, fillWidth, barHeight,
				barHeight, barHeight));
		}
	}

	// ─── helpers ─────────────────────────────────────────────────────────

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
