import { JsonContains } from 'typeorm';
import { ContentPreferenceOrganization } from '../../entity/contentPreference/ContentPreferenceOrganization';
import { NotificationType } from '../../notifications/common';
import { generateTypedNotificationWorker } from '../notifications/worker';
import { OrganizationMemberRole } from '../../roles';

export const organizationUserJoined =
  generateTypedNotificationWorker<'api.v1.organization-user-joined'>({
    subscription: 'api.organization-user-joined',
    handler: async ({ organizationId, memberId }, con, logger) => {
      const member = await con
        .getRepository(ContentPreferenceOrganization)
        .findOneOrFail({
          where: { organizationId, userId: memberId },
          relations: {
            organization: true,
            user: true,
          },
        });

      const organization = await member.organization;
      const user = await member.user;

      const owner = await con
        .getRepository(ContentPreferenceOrganization)
        .findOne({
          where: {
            organizationId,
            flags: JsonContains({ role: OrganizationMemberRole.Owner }),
          },
          relations: {
            user: true,
          },
        });

      if (!owner) {
        logger.info(
          { organizationId, memberId },
          'No owner found for organization',
        );
        return;
      }

      return [
        {
          type: NotificationType.OrganizationMemberJoined,
          ctx: {
            userIds: [owner.userId],
            user,
            organization,
          },
        },
      ];
    },
  });
