import type { EndpointView, ProfileView } from './api.ts';
import type { EndpointOption, ProfileOption } from './setup.ts';

export function toProfileOption(profile: ProfileView): ProfileOption {
  const option: ProfileOption = {
    slug: profile.slug,
    label: profile.label,
    detail: profile.detail,
  };
  if (profile.blockedReason !== null) option.blockedReason = profile.blockedReason;
  return option;
}

export function toEndpointOption(endpoint: EndpointView): EndpointOption {
  const parsed = endpoint.lastEventAt === null ? Number.NaN : Date.parse(endpoint.lastEventAt);
  return {
    name: endpoint.name,
    state: endpoint.state,
    eventCount: endpoint.eventCount,
    lastEventAt: Number.isFinite(parsed) ? parsed : null,
  };
}
