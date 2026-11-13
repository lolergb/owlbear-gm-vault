import { describe, expect, it } from '@jest/globals';
import { ACTIVE_ANNOUNCEMENT_CAMPAIGN } from '../../../js/config/announcementCampaign.js';

describe('announcement campaign configuration', () => {
  it('ships without an active campaign', () => {
    expect(ACTIVE_ANNOUNCEMENT_CAMPAIGN).toBeNull();
  });
});

