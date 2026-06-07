export interface GitHubProjectFieldOption {
	id: string;
	name: string;
}

export interface GitHubProjectField {
	id: string;
	name: string;
	options: GitHubProjectFieldOption[];
}

export interface GitHubProjectInfo {
	id: string;
	title: string;
	statusFieldId?: string;
	iceboxOptionId?: string;
	backlogOptionId?: string;
}

export interface GitHubProjectItem {
	id: string;
	title: string;
	body: string;
}

interface GraphQLResponse<T> {
	data?: T;
	errors?: { message: string }[];
}

export class GitHubClient {
	private endpoint: string;

	constructor(private token: string, endpoint?: string) {
		this.endpoint = endpoint || 'https://api.github.com/graphql';
	}

	/**
	 * Internal helper to run standard fetch against the GitHub GraphQL API.
	 */
	private async runQuery<T>(query: string, variables: Record<string, any>): Promise<T> {
		if (!this.token) {
			throw new Error('GitHub API token is not configured.');
		}

		const response = await fetch(this.endpoint, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${this.token}`,
				'Content-Type': 'application/json',
				'User-Agent': 'Myo-Core-Client'
			},
			body: JSON.stringify({ query, variables })
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`GitHub GraphQL HTTP error: ${response.status} - ${errorText}`);
		}

		const result = (await response.json()) as GraphQLResponse<T>;

		// If we got errors but NO data at all, throw
		if (result.errors && !result.data) {
			const errMsgs = result.errors.map(e => e.message).join(', ');
			throw new Error(`GitHub GraphQL Error: ${errMsgs}`);
		}

		// Return the data, even if there are partial warnings/errors
		return result.data as T;
	}

	/**
	 * Queries organization or user to find the ProjectV2 matching projectNumber.
	 * Identifies the Status field and the option IDs for Icebox and Backlog columns.
	 */
	async getProjectInfo(owner: string, projectNumber: number): Promise<GitHubProjectInfo> {
		const query = `
			query ($owner: String!, $number: Int!) {
				organization(login: $owner) {
					projectV2(number: $number) {
						id
						title
						fields(first: 100) {
							nodes {
								... on ProjectV2SingleSelectField {
									id
									name
									options {
										id
										name
									}
								}
							}
						}
					}
				}
				user(login: $owner) {
					projectV2(number: $number) {
						id
						title
						fields(first: 100) {
							nodes {
								... on ProjectV2SingleSelectField {
									id
									name
									options {
										id
										name
									}
								}
							}
						}
					}
				}
			}
		`;

		const data = await this.runQuery<any>(query, { owner, number: projectNumber });
		const project = data?.organization?.projectV2 || data?.user?.projectV2;

		if (!project) {
			throw new Error(`Could not find GitHub Project board #${projectNumber} under owner "${owner}".`);
		}

		const info: GitHubProjectInfo = {
			id: project.id,
			title: project.title
		};

		// Find the Single Select field named "Status" (case-insensitive)
		const fields = project.fields?.nodes || [];
		const statusField = fields.find(
			(f: any) => f && f.name && f.name.toLowerCase() === 'status'
		);

		if (statusField) {
			info.statusFieldId = statusField.id;
			const options = statusField.options || [];

			const iceboxOpt = options.find(
				(o: any) => o && o.name && o.name.toLowerCase() === 'icebox'
			);
			if (iceboxOpt) {
				info.iceboxOptionId = iceboxOpt.id;
			}

			const backlogOpt = options.find(
				(o: any) => o && o.name && o.name.toLowerCase() === 'backlog'
			);
			if (backlogOpt) {
				info.backlogOptionId = backlogOpt.id;
			}
		}

		return info;
	}

	/**
	 * Fetches all items in the Project and filters them by Status field matching the Icebox option ID.
	 */
	async fetchIceboxItems(owner: string, projectNumber: number): Promise<GitHubProjectItem[]> {
		const info = await this.getProjectInfo(owner, projectNumber);
		if (!info.iceboxOptionId) {
			throw new Error('Could not find an "Icebox" column in the Project\'s "Status" field.');
		}

		const query = `
			query ($owner: String!, $number: Int!) {
				organization(login: $owner) {
					projectV2(number: $number) {
						items(first: 100) {
							nodes {
								id
								content {
									... on DraftIssue {
										title
										body
									}
									... on Issue {
										title
										body
									}
									... on PullRequest {
										title
										body
									}
								}
								fieldValues(first: 100) {
									nodes {
										... on ProjectV2ItemFieldSingleSelectValue {
											optionId
											field {
												... on ProjectV2FieldCommon {
													id
													name
												}
											}
										}
									}
								}
							}
						}
					}
				}
				user(login: $owner) {
					projectV2(number: $number) {
						items(first: 100) {
							nodes {
								id
								content {
									... on DraftIssue {
										title
										body
									}
									... on Issue {
										title
										body
									}
									... on PullRequest {
										title
										body
									}
								}
								fieldValues(first: 100) {
									nodes {
										... on ProjectV2ItemFieldSingleSelectValue {
											optionId
											field {
												... on ProjectV2FieldCommon {
													id
													name
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
		`;

		const data = await this.runQuery<any>(query, { owner, number: projectNumber });
		const project = data?.organization?.projectV2 || data?.user?.projectV2;
		if (!project) {
			return [];
		}

		const nodes = project.items?.nodes || [];
		const result: GitHubProjectItem[] = [];

		for (const node of nodes) {
			if (!node || !node.content) {
				continue;
			}

			// Find Status single select value
			const fieldValues = node.fieldValues?.nodes || [];
			const statusValue = fieldValues.find(
				(fv: any) =>
					fv &&
					fv.field &&
					fv.field.name &&
					fv.field.name.toLowerCase() === 'status'
			);

			// Match optionId with Icebox optionId
			if (statusValue && statusValue.optionId === info.iceboxOptionId) {
				result.push({
					id: node.id,
					title: node.content.title || '',
					body: node.content.body || ''
				});
			}
		}

		return result;
	}

	/**
	 * Creates a draft issue user story and assigns its Status column to Backlog.
	 */
	async addStoryToBacklog(
		owner: string,
		projectNumber: number,
		title: string,
		body: string
	): Promise<string> {
		const info = await this.getProjectInfo(owner, projectNumber);

		if (!info.statusFieldId) {
			throw new Error('Could not find "Status" field on the GitHub Project board.');
		}
		if (!info.backlogOptionId) {
			throw new Error('Could not find a "Backlog" column in the Project\'s "Status" field.');
		}

		// Mutation 1: Add draft issue
		const addDraftMutation = `
			mutation ($projectId: ID!, $title: String!, $body: String) {
				addProjectV2DraftIssue(input: {projectId: $projectId, title: $title, body: $body}) {
					projectItem {
						id
					}
				}
			}
		`;

		const addResult = await this.runQuery<any>(addDraftMutation, {
			projectId: info.id,
			title,
			body
		});

		const itemId = addResult?.addProjectV2DraftIssue?.projectItem?.id;
		if (!itemId) {
			throw new Error('Failed to create draft issue on the Project board.');
		}

		// Mutation 2: Set Status field to Backlog option ID
		const updateFieldMutation = `
			mutation ($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
				updateProjectV2ItemFieldValue(
					input: {
						projectId: $projectId
						itemId: $itemId
						fieldId: $fieldId
						value: {
							singleSelectOptionId: $optionId
						}
					}
				) {
					projectV2Item {
						id
					}
				}
			}
		`;

		await this.runQuery<any>(updateFieldMutation, {
			projectId: info.id,
			itemId,
			fieldId: info.statusFieldId,
			optionId: info.backlogOptionId
		});

		return itemId;
	}
}
