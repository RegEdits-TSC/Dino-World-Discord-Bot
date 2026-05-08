package dev.homeology.dinoworld.command;

import net.dv8tion.jda.api.Permission;
import net.dv8tion.jda.api.entities.Member;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Smoke tests for {@link PermissionGate}.
 *
 * <p>Member is mocked because exercising real JDA Member objects requires
 * a full guild + user fixture, which would be overkill for permission logic.
 */
class PermissionGateTest {

	private static final long DEV = 111L;
	private static final long OTHER = 222L;

	private final PermissionGate gate = new PermissionGate(DEV);

	@Test
	void developerBypassesEverything() {
		Command cmd = stub(true, Set.of(Permission.ADMINISTRATOR));
		assertEquals(PermissionGate.Decision.ALLOW,
			gate.check(DEV, /*member*/ null, cmd));
	}

	@Test
	void nonDeveloperDeniedForDevOnly() {
		Command cmd = stub(true, Set.of());
		assertEquals(PermissionGate.Decision.DENY_DEV_ONLY,
			gate.check(OTHER, /*member*/ null, cmd));
	}

	@Test
	void nonDeveloperDeniedWithoutRequiredPerms() {
		Member member = mock(Member.class);
		when(member.hasPermission(Set.of(Permission.MANAGE_CHANNEL))).thenReturn(false);
		Command cmd = stub(false, Set.of(Permission.MANAGE_CHANNEL));
		assertEquals(PermissionGate.Decision.DENY_MISSING_PERMS,
			gate.check(OTHER, member, cmd));
	}

	@Test
	void nonDeveloperAllowedWithRequiredPerms() {
		Member member = mock(Member.class);
		when(member.hasPermission(Set.of(Permission.MANAGE_CHANNEL))).thenReturn(true);
		Command cmd = stub(false, Set.of(Permission.MANAGE_CHANNEL));
		assertEquals(PermissionGate.Decision.ALLOW,
			gate.check(OTHER, member, cmd));
	}

	@Test
	void publicCommandAllowedForAnyone() {
		Command cmd = stub(false, Set.of());
		assertEquals(PermissionGate.Decision.ALLOW,
			gate.check(OTHER, /*member*/ null, cmd));
	}

	@Test
	void missingMemberWhenPermsRequiredIsDenied() {
		Command cmd = stub(false, Set.of(Permission.MANAGE_CHANNEL));
		assertEquals(PermissionGate.Decision.DENY_MISSING_PERMS,
			gate.check(OTHER, /*member*/ null, cmd));
	}

	private static Command stub(boolean devOnly, Set<Permission> perms) {
		return new Command() {
			@Override
			public net.dv8tion.jda.api.interactions.commands.build.SlashCommandData slashData() {
				throw new UnsupportedOperationException();
			}

			@Override
			public void execute(
				net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent e,
				CommandContext ctx) {
				throw new UnsupportedOperationException();
			}

			@Override
			public boolean devOnly() {
				return devOnly;
			}

			@Override
			public Set<Permission> requiredPerms() {
				return perms;
			}
		};
	}
}
