package dev.homeology.dinoworld.modules.zoo;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.InputStream;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Loads (and caches) the per-rarity egg PNG resources used by the shop
 * embed and the egg-ready notification.
 *
 * <p>Files are expected at {@code src/main/resources/data/eggs/<rarity>.png}
 * (six total — common.png, uncommon.png, ..., mythic.png). Discord embeds
 * reference each as {@code attachment://<rarity>.png} after the bot
 * uploads it via {@code FileUpload.fromData}.
 *
 * <p>Files are loaded lazily on first request and cached in memory. Missing
 * files return {@link Optional#empty()} — by design, so the embed-building
 * code can fall back to a colored embed without an image when the user
 * hasn't yet dropped the PNG into the resources directory.
 *
 * <p>The cache is process-lifetime; if the user replaces a PNG and rebuilds
 * the jar, restart the bot to pick it up.
 */
public final class EggImageProvider {

	private static final Logger log = LoggerFactory.getLogger(EggImageProvider.class);

	private final Map<String, Optional<byte[]>> cache = new ConcurrentHashMap<>();

	/**
	 * @param rarityId one of {@link RarityCatalog#KNOWN_IDS}
	 * @return the PNG bytes, or empty if the file isn't on the classpath
	 */
	public Optional<byte[]> bytesFor(String rarityId) {
		return cache.computeIfAbsent(rarityId.toLowerCase(), this::load);
	}

	/**
	 * @param rarityId one of {@link RarityCatalog#KNOWN_IDS}
	 * @return the conventional filename (e.g. "common.png") whether or not
	 *         the file exists. Embeds reference {@code attachment://<filename>}.
	 */
	public String filenameFor(String rarityId) {
		return rarityId.toLowerCase() + ".png";
	}

	private Optional<byte[]> load(String rarityId) {
		String path = "data/eggs/" + rarityId + ".png";
		try (InputStream in = Thread.currentThread().getContextClassLoader()
			.getResourceAsStream(path)) {
			if (in == null) {
				log.info("Egg image '{}' missing from classpath; embeds will fall back without an image", path);
				return Optional.empty();
			}
			byte[] bytes = in.readAllBytes();
			log.debug("Loaded {} ({} bytes)", path, bytes.length);
			return Optional.of(bytes);
		} catch (Exception e) {
			log.warn("Failed to load egg image '{}': {}", path, e.toString());
			return Optional.empty();
		}
	}
}
