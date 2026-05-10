package dev.homeology.dinoworld.modules.players;

import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Behavior tests for {@link RankCardRenderer}. Validates that the
 * rendered PNG round-trips through {@link ImageIO} at the expected
 * dimensions, that the placeholder path doesn't crash on a missing
 * avatar, and that the input-validation guards fire for bad arguments.
 *
 * <p>Doesn't pixel-compare — Java font rendering is OS-dependent and
 * brittle to assert on. Instead we check the structural invariants
 * the consumers actually care about.
 */
class RankCardRendererTest {

	@Test
	void rendersAtCanonicalDimensions() throws Exception {
		byte[] png = RankCardRenderer.render("Alice", 5, 200L, 500L, dummyAvatar());
		assertNotNull(png);
		assertTrue(png.length > 100, "non-trivial PNG was produced");

		BufferedImage decoded = ImageIO.read(new ByteArrayInputStream(png));
		assertNotNull(decoded, "PNG decoded");
		assertEquals(RankCardRenderer.WIDTH, decoded.getWidth());
		assertEquals(RankCardRenderer.HEIGHT, decoded.getHeight());
	}

	@Test
	void nullAvatarRendersPlaceholderWithoutCrashing() throws Exception {
		byte[] png = RankCardRenderer.render("Bob", 1, 0L, 100L, null);
		BufferedImage decoded = ImageIO.read(new ByteArrayInputStream(png));
		assertEquals(RankCardRenderer.WIDTH, decoded.getWidth());
		assertEquals(RankCardRenderer.HEIGHT, decoded.getHeight());
	}

	@Test
	void zeroXpInLevelStillProducesValidPng() throws Exception {
		byte[] png = RankCardRenderer.render("Fresh", 1, 0L, 100L, dummyAvatar());
		assertNotNull(ImageIO.read(new ByteArrayInputStream(png)));
	}

	@Test
	void fullProgressClampsAtBarEnd() throws Exception {
		// xpInLevel == xpToNext is the visual edge case — bar fill should be
		// the full width and not overflow. We can't pixel-check easily, but
		// the renderer must not throw or return null.
		byte[] png = RankCardRenderer.render("Maxed", 9, 900L, 900L, dummyAvatar());
		assertNotNull(ImageIO.read(new ByteArrayInputStream(png)));
	}

	@Test
	void blankNameFallsBackToUnknownLabel() throws Exception {
		// Blank/null names are normalized internally — should not crash.
		byte[] png1 = RankCardRenderer.render("", 1, 0L, 100L, null);
		byte[] png2 = RankCardRenderer.render(null, 1, 0L, 100L, null);
		assertNotNull(ImageIO.read(new ByteArrayInputStream(png1)));
		assertNotNull(ImageIO.read(new ByteArrayInputStream(png2)));
	}

	@Test
	void veryLongNameTruncatesGracefully() throws Exception {
		String huge = "A".repeat(200);
		byte[] png = RankCardRenderer.render(huge, 5, 100L, 200L, dummyAvatar());
		assertNotNull(ImageIO.read(new ByteArrayInputStream(png)));
	}

	@Test
	void rejectsNonPositiveXpToNext() {
		assertThrows(IllegalArgumentException.class,
			() -> RankCardRenderer.render("X", 1, 0L, 0L, null));
		assertThrows(IllegalArgumentException.class,
			() -> RankCardRenderer.render("X", 1, 0L, -1L, null));
	}

	@Test
	void maxLevelOverloadAcceptsZeroXpToNextAndRendersValidPng() throws Exception {
		// At the level cap, callers pass placeholder XP values and the
		// maxLevel flag — the renderer must accept zero/junk XP without
		// throwing, swap the bar fill to full, and write "MAX" instead
		// of "0 / 0 XP".
		byte[] png = RankCardRenderer.render(
			"Maxed", 100, 0L, 1L, dummyAvatar(), true);
		BufferedImage decoded = ImageIO.read(new ByteArrayInputStream(png));
		assertEquals(RankCardRenderer.WIDTH, decoded.getWidth());
		assertEquals(RankCardRenderer.HEIGHT, decoded.getHeight());
	}

	@Test
	void rejectsNonPositiveLevel() {
		assertThrows(IllegalArgumentException.class,
			() -> RankCardRenderer.render("X", 0, 0L, 100L, null));
		assertThrows(IllegalArgumentException.class,
			() -> RankCardRenderer.render("X", -3, 0L, 100L, null));
	}

	@Test
	void backgroundLoaderFindsShippedAsset() throws Exception {
		// data/rank/background.png ships with the bot, so the loader must
		// find and decode it — and the rendered card must come out at the
		// canonical canvas dimensions regardless of source-asset size.
		RankCardRenderer.resetBackgroundCacheForTest();
		var loaded = RankCardRenderer.loadBackground();
		assertTrue(loaded.isPresent(), "shipped asset present on classpath");
		assertTrue(loaded.get().getWidth() > 0 && loaded.get().getHeight() > 0,
			"asset decoded as a real image");

		byte[] png = RankCardRenderer.render("Banner", 3, 60L, 300L, dummyAvatar());
		BufferedImage decoded = ImageIO.read(new ByteArrayInputStream(png));
		assertEquals(RankCardRenderer.WIDTH, decoded.getWidth());
		assertEquals(RankCardRenderer.HEIGHT, decoded.getHeight());
	}

	@Test
	void canonicalDimensionsMatchAssetAspectRatio() {
		// Sanity guard: the card is sized to a 3:1 ratio so a 2172×724
		// (or any 3:1 multiple) background drops in cleanly with no
		// stretch. If someone bumps WIDTH or HEIGHT without matching the
		// other, this catches it.
		assertEquals(3.0, (double) RankCardRenderer.WIDTH / RankCardRenderer.HEIGHT, 0.001,
			"card is 3:1 to match the shipped background asset");
	}

	@Test
	void writePreviewPngsToBuildDir() throws Exception {
		// Local-iteration helper: every `./gradlew test` writes a handful of
		// representative rank cards to build/rank-preview/ so a developer
		// tweaking colors, fonts, or layout can open the PNGs in any image
		// viewer for instant visual feedback — no need to run the bot
		// against a live Discord guild.
		//
		// Asserts only that the files land on disk; visual review is by eye.
		Path outDir = Path.of("build", "rank-preview");
		Files.createDirectories(outDir);

		record Scenario(String filename, String name, int level,
		                long xpInLevel, long xpToNext, boolean withAvatar) {}

		var scenarios = List.of(
			new Scenario("01-fresh.png",          "Alice",                    1,    0L,  100L, true),
			new Scenario("02-mid-progress.png",   "Bob",                      5,  250L,  500L, true),
			new Scenario("03-near-levelup.png",   "Charlie",                 12, 1100L, 1200L, true),
			new Scenario("04-long-name.png",      "VeryLongDinoWranglerName", 8,  400L,  800L, true),
			new Scenario("05-no-avatar.png",      "Placeholder",              4,  150L,  400L, false));

		for (var s : scenarios) {
			byte[] png = RankCardRenderer.render(s.name(), s.level(),
				s.xpInLevel(), s.xpToNext(),
				s.withAvatar() ? dummyAvatar() : null);
			Path target = outDir.resolve(s.filename());
			Files.write(target, png);
			assertTrue(Files.size(target) > 100, "preview PNG written");
		}
	}

	private static BufferedImage dummyAvatar() {
		// 256-square solid color stand-in for a CDN avatar download — the
		// renderer's circular clip is what we exercise, not the source pixels.
		BufferedImage img = new BufferedImage(256, 256, BufferedImage.TYPE_INT_ARGB);
		Graphics2D g = img.createGraphics();
		g.setColor(new Color(0x00FF00));
		g.fillRect(0, 0, 256, 256);
		g.dispose();
		return img;
	}
}
