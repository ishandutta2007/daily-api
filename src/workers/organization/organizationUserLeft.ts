import { JsonContains } from 'typeorm';
import { ContentPreferenceOrganization } from '../../entity/contentPreference/ContentPreferenceOrganization';
import type { TypedWorker } from '../worker';
import { OrganizationMemberRole } from '../../roles';
import {
  CioTransactionalMessageTemplateId,
  getOrganizationPermalink,
  sendEmail,
} from '../../common';
import { Organization, User } from '../../entity';

export const organizationUserLeft: TypedWorker<'api.v1.organization-user-left'> =
  {
    subscription: 'api.organization-user-left',
    handler: async ({ data }, con, logger) => {
      const { organizationId, memberId } = data;

      const [organization, user] = await Promise.all([
        con.getRepository(Organization).findOneBy({
          id: organizationId,
        }),
        con.getRepository(User).findOneBy({
          id: memberId,
        }),
      ]);

      if (!organization) {
        logger.error({ organizationId }, 'Organization not found');
        return;
      }
      if (!user) {
        logger.error({ userId: memberId }, 'User not found');
        return;
      }

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
        logger.error(
          { organizationId, userId: memberId },
          'No owner found for organization',
        );
        return;
      }

      const ownerUser = await owner.user;

      await sendEmail({
        send_to_unsubscribed: false,
        transactional_message_id:
          CioTransactionalMessageTemplateId.OrganizationMemberLeft,
        message_data: {
          organization: {
            name: organization.name,
            href: getOrganizationPermalink(organization),
          },
          member: {
            name: user.name,
          },
        },
        identifiers: {
          id: ownerUser.id,
        },
        to: ownerUser.email,
      });
    },
  };
