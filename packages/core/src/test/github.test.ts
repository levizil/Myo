import * as assert from 'assert';
import { GitHubClient } from '../clients/github';

suite('GitHubClient GraphQL Tests', () => {
	let originalFetch: typeof globalThis.fetch;
	let mockFetchCalls: { url: string; options: any }[] = [];
	let mockFetchResponse: any = {};
	let mockFetchStatus = 200;
	let mockFetchStatusText = 'OK';

	setup(() => {
		originalFetch = globalThis.fetch;
		globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
			mockFetchCalls.push({ url: url.toString(), options });
			return {
				ok: mockFetchStatus >= 200 && mockFetchStatus < 300,
				status: mockFetchStatus,
				statusText: mockFetchStatusText,
				text: async () => JSON.stringify(mockFetchResponse),
				json: async () => mockFetchResponse
			} as Response;
		};
	});

	teardown(() => {
		globalThis.fetch = originalFetch;
		mockFetchCalls = [];
		mockFetchResponse = {};
		mockFetchStatus = 200;
		mockFetchStatusText = 'OK';
	});

	test('getProjectInfo successfully parses organization project', async () => {
		mockFetchResponse = {
			data: {
				organization: {
					projectV2: {
						id: 'proj_123',
						title: 'My Project',
						fields: {
							nodes: [
								{
									id: 'field_status_id',
									name: 'Status',
									options: [
										{ id: 'opt_icebox_id', name: 'Icebox' },
										{ id: 'opt_backlog_id', name: 'Backlog' }
									]
								}
							]
						}
					}
				},
				user: null
			}
		};

		const client = new GitHubClient('fake-token');
		const info = await client.getProjectInfo('my-org', 1);

		assert.strictEqual(info.id, 'proj_123');
		assert.strictEqual(info.title, 'My Project');
		assert.strictEqual(info.statusFieldId, 'field_status_id');
		assert.strictEqual(info.iceboxOptionId, 'opt_icebox_id');
		assert.strictEqual(info.backlogOptionId, 'opt_backlog_id');

		assert.strictEqual(mockFetchCalls.length, 1);
		const reqBody = JSON.parse(mockFetchCalls[0].options.body);
		assert.ok(reqBody.query.includes('organization'));
		assert.strictEqual(reqBody.variables.owner, 'my-org');
		assert.strictEqual(reqBody.variables.number, 1);
	});

	test('getProjectInfo successfully parses user project', async () => {
		mockFetchResponse = {
			data: {
				organization: null,
				user: {
					projectV2: {
						id: 'proj_user_123',
						title: 'User Project',
						fields: {
							nodes: [
								{
									id: 'field_status_id',
									name: 'status',
									options: [
										{ id: 'opt_icebox_id', name: 'icebox' },
										{ id: 'opt_backlog_id', name: 'backlog' }
									]
								}
							]
						}
					}
				}
			}
		};

		const client = new GitHubClient('fake-token');
		const info = await client.getProjectInfo('my-user', 2);

		assert.strictEqual(info.id, 'proj_user_123');
		assert.strictEqual(info.statusFieldId, 'field_status_id');
		assert.strictEqual(info.iceboxOptionId, 'opt_icebox_id');
		assert.strictEqual(info.backlogOptionId, 'opt_backlog_id');
	});

	test('getProjectInfo throws error when project is not found', async () => {
		mockFetchResponse = {
			data: {
				organization: null,
				user: null
			}
		};

		const client = new GitHubClient('fake-token');
		await assert.rejects(
			client.getProjectInfo('my-org', 3),
			/Could not find GitHub Project board #3/
		);
	});

	test('fetchIceboxItems retrieves and filters icebox items correctly', async () => {
		// Mock responses:
		// 1st request (getProjectInfo)
		// 2nd request (fetchIceboxItems)
		let callCount = 0;
		globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
			callCount++;
			let resBody = {};
			if (callCount === 1) {
				resBody = {
					data: {
						organization: {
							projectV2: {
								id: 'proj_123',
								title: 'Project Title',
								fields: {
									nodes: [
										{
											id: 'field_status_id',
											name: 'Status',
											options: [
												{ id: 'opt_icebox_id', name: 'Icebox' },
												{ id: 'opt_backlog_id', name: 'Backlog' }
											]
										}
									]
								}
							}
						}
					}
				};
			} else {
				resBody = {
					data: {
						organization: {
							projectV2: {
								items: {
									nodes: [
										{
											id: 'item_1',
											content: { title: 'Icebox Story 1', body: 'Story 1 details' },
											fieldValues: {
												nodes: [
													{
														optionId: 'opt_icebox_id',
														field: { id: 'field_status_id', name: 'Status' }
													}
												]
											}
										},
										{
											id: 'item_2',
											content: { title: 'Backlog Story', body: 'Other details' },
											fieldValues: {
												nodes: [
													{
														optionId: 'opt_backlog_id',
														field: { id: 'field_status_id', name: 'Status' }
													}
												]
											}
										}
									]
								}
							}
						}
					}
				};
			}
			return {
				ok: true,
				status: 200,
				json: async () => resBody
			} as Response;
		};

		const client = new GitHubClient('fake-token');
		const items = await client.fetchIceboxItems('my-org', 1);

		assert.strictEqual(items.length, 1);
		assert.strictEqual(items[0].id, 'item_1');
		assert.strictEqual(items[0].title, 'Icebox Story 1');
		assert.strictEqual(items[0].body, 'Story 1 details');
	});

	test('addStoryToBacklog performs add and update field value mutations', async () => {
		let callCount = 0;
		let addMutationVariables: any = null;
		let updateMutationVariables: any = null;

		globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
			callCount++;
			const reqBody = JSON.parse(options?.body as string);
			let resBody = {};

			if (callCount === 1) {
				// getProjectInfo
				resBody = {
					data: {
						organization: {
							projectV2: {
								id: 'proj_123',
								title: 'Project Title',
								fields: {
									nodes: [
										{
											id: 'field_status_id',
											name: 'Status',
											options: [
												{ id: 'opt_icebox_id', name: 'Icebox' },
												{ id: 'opt_backlog_id', name: 'Backlog' }
											]
										}
									]
								}
							}
						}
					}
				};
			} else if (callCount === 2) {
				// addProjectV2DraftIssue
				addMutationVariables = reqBody.variables;
				resBody = {
					data: {
						addProjectV2DraftIssue: {
							projectItem: {
								id: 'new_item_id'
							}
						}
					}
				};
			} else {
				// updateProjectV2ItemFieldValue
				updateMutationVariables = reqBody.variables;
				resBody = {
					data: {
						updateProjectV2ItemFieldValue: {
							projectV2Item: {
								id: 'new_item_id'
							}
						}
					}
				};
			}

			return {
				ok: true,
				status: 200,
				json: async () => resBody
			} as Response;
		};

		const client = new GitHubClient('fake-token');
		const newItemId = await client.addStoryToBacklog('my-org', 1, 'New Story Title', 'New Story Body');

		assert.strictEqual(newItemId, 'new_item_id');
		assert.strictEqual(callCount, 3);

		// Verify first mutation payload
		assert.strictEqual(addMutationVariables.projectId, 'proj_123');
		assert.strictEqual(addMutationVariables.title, 'New Story Title');
		assert.strictEqual(addMutationVariables.body, 'New Story Body');

		// Verify second mutation payload
		assert.strictEqual(updateMutationVariables.projectId, 'proj_123');
		assert.strictEqual(updateMutationVariables.itemId, 'new_item_id');
		assert.strictEqual(updateMutationVariables.fieldId, 'field_status_id');
		assert.strictEqual(updateMutationVariables.optionId, 'opt_backlog_id');
	});
});
